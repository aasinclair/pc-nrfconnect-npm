/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Alert,
    Button,
    DialogButton,
    GenericDialog,
    Group,
    useStopwatch,
} from 'pc-nrfconnect-shared';

import { CCProfile } from '../../features/pmicControl/npm/types';
import {
    getChargers,
    getLatestAdcSample,
    getNpmDevice,
    getPmicChargingState,
    isBatteryConnected,
    isUsbPowered,
} from '../../features/pmicControl/pmicControlSlice';
import {
    closeProfiling,
    getProfile,
    getProfileIndex,
    getProfilingStage,
    setCompleteStep,
    setProfilingStage,
} from '../../features/pmicControl/profilingSlice';
import { REST_DURATION } from './helpers';
import { ElapsedTime } from './TimeComponent';

export default () => {
    const npmDevice = useSelector(getNpmDevice);
    const usbPowered = useSelector(isUsbPowered);
    const chargers = useSelector(getChargers);
    const pmicChargingState = useSelector(getPmicChargingState);
    const batteryConnected = useSelector(isBatteryConnected);
    const profilingStage = useSelector(getProfilingStage);
    const profile = useSelector(getProfile);
    const adcSample = useSelector(getLatestAdcSample);
    const index = useSelector(getProfileIndex);
    const [batteryFull, setBatteryFull] = useState(
        pmicChargingState.batteryFull
    );

    const { time, pause } = useStopwatch({
        autoStart: true,
        resolution: 1000,
    });

    const dispatch = useDispatch();

    useEffect(() => {
        if (pmicChargingState.batteryFull) {
            setBatteryFull(true);
            pause();
        }
    }, [pause, pmicChargingState]);

    return (
        <GenericDialog
            title={`Battery Profiling ${
                profile.name.length > 0 ? `- ${profile.name}` : ''
            } @ ${profile.temperatures[index]} °C`}
            isVisible={profilingStage === 'Charging'}
            showSpinner={!batteryFull}
            closeOnEsc={false}
            footer={
                <>
                    <DialogButton
                        variant="primary"
                        disabled={
                            !batteryFull || usbPowered || !batteryConnected
                        }
                        onClick={() => {
                            const restingProfiles: CCProfile[] = [
                                {
                                    tLoad: 500,
                                    tRest: 500,
                                    iLoad: 0,
                                    iRest: 0,
                                    cycles: REST_DURATION,
                                },
                            ];
                            const profilingProfiles: CCProfile[] = [
                                {
                                    tLoad: 500,
                                    tRest: 500,
                                    iLoad: 0,
                                    iRest: 0,
                                    cycles: 300, // 5Min
                                },
                                {
                                    tLoad: 600000, // 10Min
                                    tRest: 2400000, // 40Min
                                    iLoad: profile.capacity / 5 / 1000, // A
                                    iRest: 0,
                                    vCutoff: 3.9,
                                },
                                {
                                    tLoad: 300000, // 5Min
                                    tRest: 1800000, // 30Min
                                    iLoad: profile.capacity / 5 / 1000, // A
                                    iRest: 0,
                                    vCutoff: 3.5,
                                },
                                {
                                    tLoad: 300000, // 5Min
                                    tRest: 1800000, // 30Min
                                    iLoad: profile.capacity / 10 / 1000, // A
                                    iRest: 0,
                                },
                            ];

                            dispatch(setProfilingStage('Resting'));
                            npmDevice?.setAutoRebootDevice(false);
                            npmDevice
                                ?.setChargerEnabled(0, false)
                                .then(() => {
                                    npmDevice
                                        ?.getBatteryProfiler()
                                        ?.setProfile(
                                            REST_DURATION, // iBat
                                            REST_DURATION * 8, // tBat
                                            profile.vLowerCutOff,
                                            [
                                                ...restingProfiles,
                                                ...profilingProfiles,
                                            ]
                                        )
                                        .then(() => {
                                            npmDevice
                                                ?.getBatteryProfiler()
                                                ?.startProfiling();
                                        })
                                        .catch(message => {
                                            dispatch(
                                                setCompleteStep({
                                                    message,
                                                    level: 'danger',
                                                })
                                            );
                                        });
                                })
                                .catch(message => {
                                    dispatch(
                                        setCompleteStep({
                                            message,
                                            level: 'danger',
                                        })
                                    );
                                });
                        }}
                    >
                        Continue
                    </DialogButton>
                    <DialogButton
                        onClick={() => {
                            dispatch(closeProfiling());
                        }}
                    >
                        Abort
                    </DialogButton>
                </>
            }
        >
            <Group>
                {!batteryConnected && (
                    <Alert label="Warning " variant="warning">
                        Did not detect battery. Please ensure battery is
                        connected.
                    </Alert>
                )}
                {!batteryFull && !usbPowered && (
                    <Alert label="Warning " variant="warning">
                        Please connect USB PMIC to continue
                    </Alert>
                )}
                {batteryFull && usbPowered && (
                    <Alert label="Warning " variant="warning">
                        Please disconnect USB PMIC to continue
                    </Alert>
                )}
                {!batteryFull && !chargers[0]?.enabled && (
                    <Alert label="" variant="warning">
                        <div className="d-flex align-items-center flex-wrap alert-warning-with-button">
                            <span>
                                <strong>Warning</strong> Charging has been
                                turned off.
                            </span>
                            <Button
                                variant="custom"
                                onClick={() => {
                                    chargers.forEach((_, i) =>
                                        npmDevice?.setChargerEnabled(i, true)
                                    );
                                }}
                            >
                                Turn on
                            </Button>
                        </div>
                    </Alert>
                )}
                {batteryFull && (
                    <Alert
                        label="Info "
                        variant="info"
                    >{`Make sure battery is in the oven with a temperature of ${profile.temperatures[index]} °C. Current NTC temperature ${adcSample?.tBat} °C`}</Alert>
                )}
                <div>
                    <span>
                        <strong>Status: </strong>
                        {!batteryFull && (
                            <span>
                                {usbPowered &&
                                batteryConnected &&
                                chargers[0].enabled
                                    ? `Charging ${
                                          pmicChargingState.constantCurrentCharging
                                              ? '(Constant current)'
                                              : ''
                                      }${
                                          pmicChargingState.constantVoltageCharging
                                              ? '(Constant voltage)'
                                              : ''
                                      }`
                                    : 'Not charging'}
                            </span>
                        )}
                        {batteryFull && <span>Charging complete</span>}
                    </span>
                </div>
                <ElapsedTime time={time} />
            </Group>
        </GenericDialog>
    );
};
