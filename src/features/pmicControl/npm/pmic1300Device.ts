/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import EventEmitter from 'events';

import { getRange } from '../../../utils/helpers';
import { baseNpmDevice } from './basePmicDevice';
import { parseColonBasedAnswer, parseToNumber } from './pmicHelpers';
import {
    AdcSample,
    Buck,
    BuckMode,
    Charger,
    INpmDevice,
    IrqEvent,
    Ldo,
    LdoMode,
    LoggingEvent,
    PartialUpdate,
    PmicChargingState,
    PmicState,
    PmicWarningDialog,
} from './types';

const maxTimeStamp = 359999999; // 99hrs 59min 59sec 999ms

const toRegex = (
    command: string,
    getSet?: boolean,
    index?: number,
    valueRegex = '[0-9]+'
) => {
    const indexRegex = index !== undefined ? ` ${index}` : '';
    if (getSet)
        command += ` (set${indexRegex} ${valueRegex}( [^\\s-]+)?|get${indexRegex})`;
    else if (index !== undefined) command += indexRegex;

    command = command.replaceAll(' ', '([^\\S\\r\\n])+');
    return `${command}`;
};

const parseTime = (timeString: string) => {
    const time = timeString.trim().split(',')[0].replace('.', ':').split(':');
    const msec = Number(time[3]);
    const sec = Number(time[2]) * 1000;
    const min = Number(time[1]) * 1000 * 60;
    const hr = Number(time[0]) * 1000 * 60 * 60;

    return msec + sec + min + hr;
};

const parseLogData = (
    logMessage: string,
    callback: (loggingEvent: LoggingEvent) => void
) => {
    const endOfTimestamp = logMessage.indexOf(']');

    const strTimeStamp = logMessage.substring(1, endOfTimestamp);

    const endOfLogLevel = logMessage.indexOf('>');

    const logLevel = logMessage.substring(
        logMessage.indexOf('<') + 1,
        endOfLogLevel
    );
    const module = logMessage.substring(
        endOfLogLevel + 2,
        logMessage.indexOf(':', endOfLogLevel)
    );
    const message = logMessage.substring(
        logMessage.indexOf(':', endOfLogLevel) + 2
    );

    callback({ timestamp: parseTime(strTimeStamp), logLevel, module, message });
};

export const getNPM1300: INpmDevice = (shellParser, warningDialogHandler) => {
    const eventEmitter = new EventEmitter();
    const devices = {
        noOfBucks: 2,
        noOfChargers: 1,
        noOfLdos: 2,
    };
    const baseDevice = baseNpmDevice(
        shellParser,
        warningDialogHandler,
        eventEmitter,
        devices,
        '0.0.0+2'
    );
    let lastUptime = 0;
    let uptimeOverflowCounter = 0;
    let deviceUptimeToSystemDelta = 0;

    // can only change from:
    //  - 'disconnected' --> 'connected' --> 'disconnected'
    //  - 'offline'
    let pmicState: PmicState = shellParser ? 'disconnected' : 'offline';

    let pmicStateUnknownTimeout: NodeJS.Timeout | undefined;

    const initConnectionTimeout = () => {
        clearConnectionTimeout();
        if (pmicState === 'offline') return;
        pmicStateUnknownTimeout = setTimeout(() => {
            pmicState = 'connected';
            eventEmitter.emit('onPmicStateChange', pmicState);
        }, 2000);
    };

    const clearConnectionTimeout = () => {
        if (pmicStateUnknownTimeout) {
            clearTimeout(pmicStateUnknownTimeout);
            pmicStateUnknownTimeout = undefined;
        }
    };

    const updateUptimeOverflowCounter = () => {
        baseDevice.kernelUptime(milliseconds => {
            deviceUptimeToSystemDelta = Date.now() - milliseconds;
            uptimeOverflowCounter = Math.floor(milliseconds / maxTimeStamp);
        });
    };

    const processModulePmic = ({ message }: LoggingEvent) => {
        switch (message) {
            case 'No response from PMIC.':
                clearConnectionTimeout();
                if (pmicState !== 'disconnected') {
                    pmicState = 'disconnected';
                    eventEmitter.emit('onPmicStateChange', pmicState);
                }
                break;
            case 'PMIC available. Application can be restarted.':
                baseDevice.kernelReset('cold');
                break;
        }
    };

    const processModulePmicAdc = ({ timestamp, message }: LoggingEvent) => {
        const messageParts = message.split(',');
        const adcSample: AdcSample = {
            timestamp,
            vBat: 0,
            iBat: 0,
            tBat: 0,
            soc: undefined,
        };
        messageParts.forEach(part => {
            const pair = part.split('=');
            switch (pair[0]) {
                case 'vbat':
                    adcSample.vBat = Number(pair[1] ?? 0);
                    break;
                case 'ibat':
                    adcSample.iBat = Number(pair[1] ?? 0);
                    break;
                case 'tbat':
                    adcSample.tBat = Number(pair[1] ?? 0);
                    break;
                case 'soc':
                    adcSample.soc = Number(pair[1] ?? undefined);
                    break;
            }
        });

        if (adcSample.timestamp < lastUptime) {
            uptimeOverflowCounter += 1;
            adcSample.timestamp += maxTimeStamp * uptimeOverflowCounter;
        }

        lastUptime = adcSample.timestamp;

        eventEmitter.emit('onAdcSample', adcSample);
    };

    const processModulePmicIrq = ({ message }: LoggingEvent) => {
        const messageParts = message.split(',');
        const event: IrqEvent = {
            type: '',
            event: '',
        };
        messageParts.forEach(part => {
            const pair = part.split('=');
            switch (pair[0]) {
                case 'type':
                    event.type = pair[1];
                    break;
                case 'bit':
                    event.event = pair[1];
                    break;
            }
        });

        doActionOnEvent(event);
    };

    const doActionOnEvent = (irqEvent: IrqEvent) => {
        console.log(irqEvent);
    };

    const startAdcSample = (samplingRate: number) => {
        sendCommand(`npm_adc_sample 500 ${samplingRate}`);
    };

    const stopAdcSample = () => {
        startAdcSample(0);
    };

    shellParser?.onShellLoggingEvent(logEvent => {
        parseLogData(logEvent, loggingEvent => {
            switch (loggingEvent.module) {
                case 'module_pmic':
                    processModulePmic(loggingEvent);
                    eventEmitter.emit('onLoggingEvent', {
                        loggingEvent,
                        dataPair: false,
                    });
                    break;
                case 'module_pmic_adc':
                    processModulePmicAdc(loggingEvent);
                    eventEmitter.emit('onLoggingEvent', {
                        loggingEvent,
                        dataPair: true,
                    });
                    break;
                case 'module_pmic_irq':
                    processModulePmicIrq(loggingEvent);
                    eventEmitter.emit('onLoggingEvent', {
                        loggingEvent,
                        dataPair: true,
                    });
                    break;
                default:
                    eventEmitter.emit('onLoggingEvent', {
                        loggingEvent,
                        dataPair: false,
                    });
                    break;
            }
        });
    });

    const emitPartialEvent = <T>(
        eventName: string,
        index: number,
        data: Partial<T>
    ) => {
        eventEmitter.emit(eventName, {
            index,
            data,
        } as PartialUpdate<T>);
    };

    shellParser?.registerCommandCallback(
        toRegex('npmx charger termination_voltage normal', true),
        res => {
            const value = parseToNumber(res);
            emitPartialEvent<Charger>('onChargerUpdate', 0, {
                vTerm: value / 1000, // mv to V
            });
        },
        console.error
    );

    shellParser?.registerCommandCallback(
        toRegex('npmx charger charger_current', true),
        res => {
            const value = parseToNumber(res);
            emitPartialEvent<Charger>('onChargerUpdate', 0, {
                iChg: value,
            });
        },
        console.error
    );

    shellParser?.registerCommandCallback(
        toRegex('npmx charger status', true),
        res => {
            const value = parseToNumber(res);
            eventEmitter.emit('onChargingStatusUpdate', {
                // batteryDetected: (value & 0x01) > 0,
                // eslint-disable-next-line no-bitwise
                batteryFull: (value & 0x02) > 0,
                // eslint-disable-next-line no-bitwise
                trickleCharge: (value & 0x04) > 0,
                // eslint-disable-next-line no-bitwise
                constantCurrentCharging: (value & 0x08) > 0,
                // eslint-disable-next-line no-bitwise
                constantVoltageCharging: (value & 0x10) > 0,
                // eslint-disable-next-line no-bitwise
                batteryRechargeNeeded: (value & 0x20) > 0,
                // eslint-disable-next-line no-bitwise
                dieTempHigh: (value & 0x40) > 0,
                // eslint-disable-next-line no-bitwise
                supplementModeActive: (value & 0x80) > 0,
            } as PmicChargingState);
        },
        console.error
    );

    shellParser?.registerCommandCallback(
        toRegex('npmx charger module charger', true),
        (_result, command) => {
            emitPartialEvent<Charger>('onChargerUpdate', 0, {
                enabled: command?.endsWith('1'),
            });
        },
        console.error
    );

    shellParser?.registerCommandCallback(
        toRegex('fuel_gauge status'),
        res => {
            eventEmitter.emit(
                'onFuelGauge',
                res.match('state=ENABLED') !== null
            );
        },
        console.error
    );

    shellParser?.registerCommandCallback(
        toRegex('fuel_gauge enable'),
        () => {
            eventEmitter.emit('onFuelGauge', true);
        },
        console.error
    );

    shellParser?.registerCommandCallback(
        toRegex('fuel_gauge disable'),
        () => {
            eventEmitter.emit('onFuelGauge', false);
        },
        console.error
    );

    for (let i = 0; i < devices.noOfBucks; i += 1) {
        shellParser?.registerCommandCallback(
            toRegex('npmx buck voltage normal', true, i),
            res => {
                const value = parseToNumber(res);
                emitPartialEvent<Buck>('onBuckUpdate', i, {
                    vOut: value / 1000, // mV to V
                });
            },
            console.error
        );

        shellParser?.registerCommandCallback(
            toRegex('npmx buck vout select', true, i, '[0-1]'),
            res => {
                const valueString = parseColonBasedAnswer(res);
                let mode: BuckMode | undefined;

                switch (valueString) {
                    case 'vset pin select':
                    case '0':
                        mode = 'vSet';
                        break;
                    case 'software select':
                    case '1':
                        mode = 'software';
                        break;
                }

                if (mode)
                    emitPartialEvent<Buck>('onBuckUpdate', i, {
                        mode,
                    });
            },
            console.error
        );

        shellParser?.registerCommandCallback(
            toRegex('npmx buck', true, i),
            (_result, command) => {
                emitPartialEvent<Buck>('onBuckUpdate', i, {
                    enabled: command?.endsWith('1'),
                });
            },
            console.error
        );
    }

    for (let i = 0; i < devices.noOfLdos; i += 1) {
        shellParser?.registerCommandCallback(
            toRegex('npmx ldsw', true, i),
            (_result, command) => {
                emitPartialEvent<Ldo>('onLdoUpdate', i, {
                    enabled: command?.endsWith('1'),
                });
            },
            console.error
        );
    }

    const sendCommand = (
        command: string,
        onSuccess?: () => void,
        onFail?: () => void
    ) => {
        if (pmicState !== 'offline') {
            const wrapper = (result: string, action?: () => void) => {
                const event: LoggingEvent = {
                    timestamp: Date.now() - deviceUptimeToSystemDelta,
                    module: 'shell_commands',
                    logLevel: 'inf',
                    message: `command: "${command}" response: "${result}"`,
                };

                eventEmitter.emit('onLoggingEvent', {
                    loggingEvent: event,
                    dataPair: true,
                });

                if (action) action();
            };
            shellParser?.enqueueRequest(
                command,
                result => wrapper(result, onSuccess),
                result => wrapper(result, onFail),
                true
            );
        }
    };

    const setChargerVTerm = (index: number, value: number) => {
        setChargerEnabled(index, false);
        sendCommand(
            `npmx charger termination_voltage normal set ${value * 1000}` // mv to V
        );

        if (pmicState === 'offline')
            emitPartialEvent<Charger>('onChargerUpdate', index, {
                vTerm: value,
            });
    };
    const setChargerIChg = (index: number, value: number) => {
        sendCommand(`npmx charger charger_current set ${value}`);

        if (pmicState === 'offline')
            emitPartialEvent<Charger>('onChargerUpdate', index, {
                iChg: value,
            });

        setChargerEnabled(index, false);
    };
    const setChargerEnabled = (index: number, enabled: boolean) => {
        sendCommand(`npmx charger module charger set ${enabled ? '1' : '0'}`);

        if (pmicState === 'offline')
            emitPartialEvent<Charger>('onChargerUpdate', index, {
                enabled,
            });

        requestUpdate.pmicChargingState();
    };

    const setBuckVOut = (index: number, value: number) => {
        const action = () => {
            sendCommand(
                `npmx buck voltage normal set ${index} ${value * 1000}`
            );

            if (pmicState === 'offline')
                emitPartialEvent<Buck>('onBuckUpdate', index, {
                    vOut: value,
                });

            setBuckMode(index, 'software');
        };

        if (index === 0 && value <= 1.7) {
            const warningDialog: PmicWarningDialog = {
                storeID: 'pmic1300-setBuckVOut-0',
                message: `Buck 1 Powers the I2C communications that are needed for this app. 
                    Any voltage lower that 1.7v Might cause issues with the Connection to the app. Are you sure you want to continue`,
                confirmLabel: 'Yes',
                optionalLabel: "Yes, Don't ask again",
                cancelLabel: 'No',
                title: 'Warning',
                onConfirm: action,
                onCancel: () => requestUpdate.buckVOut(index),
                onOptional: action,
                optionalDoNotAskAgain: true,
            };

            warningDialogHandler(warningDialog);
        } else {
            action();
        }
    };

    const setBuckMode = (index: number, mode: BuckMode) => {
        sendCommand(
            `npmx buck vout select set ${index} ${mode === 'software' ? 1 : 0}`
        );

        if (pmicState === 'offline')
            emitPartialEvent<Buck>('onBuckUpdate', index, {
                mode,
            });

        requestUpdate.buckVOut(index);
    };
    const setBuckEnabled = (index: number, enabled: boolean) => {
        const action = () => {
            sendCommand(`npmx buck set ${index} ${enabled ? '1' : '0'}`);

            if (pmicState === 'offline')
                emitPartialEvent<Buck>('onBuckUpdate', index, {
                    enabled,
                });
        };

        if (index === 0 && !enabled) {
            const warningDialog: PmicWarningDialog = {
                storeID: 'pmic1300-setBuckEnabled-0',
                message: `Disabling the buck 1 might effect I2C communications to the PMIC 1300 chip and hance you might get 
                disconnected from the app. Are you sure you want to proceed?`,
                confirmLabel: 'Yes',
                optionalLabel: "Yes, Don't ask again",
                cancelLabel: 'No',
                title: 'Warning',
                onConfirm: action,
                onCancel: () => {},
                onOptional: action,
                optionalDoNotAskAgain: true,
            };

            warningDialogHandler(warningDialog);
        } else {
            action();
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const setLdoVoltage = (index: number, value: number) =>
        console.warn('Not implemented');
    const setLdoEnabled = (index: number, enabled: boolean) => {
        sendCommand(`npmx ldsw set ${index} ${enabled ? '1' : '0'}`);

        if (pmicState === 'offline')
            emitPartialEvent<Ldo>('onLdoUpdate', index, {
                enabled,
            });
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const setLdoMode = (index: number, mode: LdoMode) =>
        console.warn('Not implemented');

    const setFuelGaugeEnabled = (enabled: boolean) => {
        sendCommand(`fuel_gauge ${enabled ? 'enable' : 'disable'}`);

        if (pmicState === 'offline') eventEmitter.emit('onFuelGauge', enabled);
    };

    initConnectionTimeout();
    updateUptimeOverflowCounter();

    const requestUpdate = {
        pmicChargingState: () => sendCommand('npmx charger status get'),
        chargerVTerm: () =>
            sendCommand('npmx charger termination_voltage normal get'),
        chargerIChg: () => sendCommand('npmx charger charger_current get'),
        chargerEnabled: (index: number) =>
            sendCommand(`npmx buck voltage normal get ${index}`),

        buckVOut: (index: number) =>
            sendCommand(`npmx buck voltage normal get ${index}`),
        buckMode: (index: number) =>
            sendCommand(`npmx buck vout select get ${index}`),
        buckEnabled: () => console.warn('Not implemented'),

        ldoVoltage: () => console.warn('Not implemented'),
        ldoEnabled: () => console.warn('Not implemented'),
        ldoMode: () => console.warn('Not implemented'),

        fuelGauge: () => {
            sendCommand('fuel_gauge status');
        },
    };

    return {
        ...baseDevice,
        applyConfig: config => {
            if (config.deviceType !== 'npm13000') {
                return;
            }

            const action = () => {
                config.chargers.forEach((charger, index) => {
                    setChargerVTerm(index, charger.vTerm);
                    setChargerIChg(index, charger.iChg);
                    setChargerEnabled(index, charger.enabled);
                });

                config.bucks.forEach((buck, index) => {
                    setBuckVOut(index, buck.vOut);
                    setBuckMode(index, buck.mode);
                    setBuckEnabled(index, buck.enabled);
                });

                config.ldos.forEach((ldo, index) => {
                    setLdoVoltage(index, ldo.voltage);
                    setLdoMode(index, ldo.mode);
                    setLdoEnabled(index, ldo.enabled);
                });

                setFuelGaugeEnabled(config.fuelGauge);
            };

            if (config.firmwareVersion !== baseDevice.getSupportedVersion()) {
                const warningDialog: PmicWarningDialog = {
                    storeID: 'pmic1300-load-config-mismatch',
                    message: `The configuration was intended for firmware version ${
                        config.firmwareVersion
                    }. Device is running a different version. 
                    ${baseDevice.getSupportedVersion()}. Do you still want to apply this configuration?`,
                    confirmLabel: 'Yes',
                    optionalLabel: "Yes, Don't ask again",
                    cancelLabel: 'No',
                    title: 'Warning',
                    onConfirm: action,
                    onCancel: () => {},
                    onOptional: action,
                    optionalDoNotAskAgain: true,
                };

                warningDialogHandler(warningDialog);
                return;
            }

            action();
        },
        getDeviceType: () => 'npm13000',
        getConnectionState: () => pmicState,
        startAdcSample,
        stopAdcSample,

        getChargerVoltageRange: () =>
            getRange([
                {
                    min: 3.5,
                    max: 3.65,
                    step: 0.05,
                },
                {
                    min: 4.0,
                    max: 4.45,
                    step: 0.05,
                },
            ]).map(v => Number(v.toFixed(2))),

        getChargerCurrentRange: () => ({
            min: 32,
            max: 800,
            decimals: 0,
            step: 2,
        }),

        getBuckVoltageRange: () => ({
            min: 1,
            max: 3.3,
            decimals: 1,
        }),

        getLdoVoltageRange: () => ({
            min: 1,
            max: 3.3,
            decimals: 1,
            step: 0.1,
        }),

        requestUpdate,

        setChargerVTerm,
        setChargerIChg,
        setChargerEnabled,
        setBuckVOut,
        setBuckMode,
        setBuckEnabled,
        setLdoVoltage,
        setLdoEnabled,
        setLdoMode,

        setFuelGaugeEnabled,
    };
};