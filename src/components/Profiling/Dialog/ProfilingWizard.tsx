/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { appendFile, writeFileSync } from 'fs';
import path from 'path';
import { Alert, ConfirmationDialog } from 'pc-nrfconnect-shared';

import {
    addConfirmBeforeClose,
    clearConfirmBeforeClose,
    getShowConfirmCloseDialog,
} from '../../../features/confirmBeforeClose/confirmBeforeCloseSlice';
import { Profile } from '../../../features/pmicControl/npm/types';
import {
    getBucks,
    getFuelGauge,
    getLdos,
    getNpmDevice,
    isBatteryConnected,
    isUsbPowered,
} from '../../../features/pmicControl/pmicControlSlice';
import {
    clearAbortAction,
    closeProfiling,
    getAbort,
    getCcProfilingState,
    getProfile,
    getProfileIndex,
    getProfilingStage,
    incrementCapacityConsumed,
    setCompleteStep,
    setLatestTBat,
    setLatestVLoad,
    setProfilingStage,
} from '../../../features/pmicControl/profilingSlice';
import {
    atomicUpdateProjectSettings,
    generateDefaultProjectPath,
    PROFILE_FOLDER_PREFIX,
    REPORTING_RATE,
} from '../helpers';
import ChargingDialog from './ChargingDialog';
import ChecklistDialog from './ChecklistDialog';
import CompleteDialog, { markProfilersAsReady } from './CompleteDialog';
import ConfigurationDialog from './ConfigurationDialog';
import PreConfigurationDialog from './PreConfigurationDialog';
import ProfilingDialog from './ProfilingDialog';
import RestingDialog from './RestingDialog';

const generateCSVFileNamePath = (profile: Profile, index: number) => {
    const baseDirectory = path.join(
        profile.baseDirectory,
        profile.name,
        `${PROFILE_FOLDER_PREFIX}${index + 1}`
    );

    return path.join(
        baseDirectory,
        `${profile.name}_${profile.capacity}mAh_T${
            profile.temperatures[index] < 0 ? 'n' : 'p'
        }${profile.temperatures[index]}.csv`
    );
};

export default () => {
    const timeOffset = useRef(-1);

    const npmDevice = useSelector(getNpmDevice);
    const profilingStage = useSelector(getProfilingStage);
    const profile = useSelector(getProfile);
    const batteryConnected = useSelector(isBatteryConnected);
    const usbPowered = useSelector(isUsbPowered);
    const ldos = useSelector(getLdos);
    const bucks = useSelector(getBucks);
    const fuelGauge = useSelector(getFuelGauge);
    const index = useSelector(getProfileIndex);
    const ccProfilingState = useSelector(getCcProfilingState);
    const abortAction = useSelector(getAbort);
    const showCloseAppDialog = useSelector(getShowConfirmCloseDialog);

    const dispatch = useDispatch();

    useEffect(() => {
        if (profilingStage) {
            dispatch(
                addConfirmBeforeClose({
                    id: 'PROFILING_WIZARD',
                    message:
                        ' Battery profiling is ongoing. All profiling data will be lost if you close the app. ',
                    onClose() {
                        dispatch(closeProfiling());
                    },
                })
            );
            return () => {
                dispatch(clearConfirmBeforeClose('PROFILING_WIZARD'));
            };
        }
    }, [dispatch, profilingStage]);

    useEffect(
        () =>
            npmDevice?.getBatteryProfiler()?.onProfilingEvent(event => {
                dispatch(
                    setLatestTBat(Number.parseFloat(event.data.tBat.toFixed(2)))
                );
                dispatch(
                    setLatestVLoad(
                        Number.parseFloat(event.data.vLoad.toFixed(2))
                    )
                );
                if (event.data.seq === 1 && profilingStage === 'Resting') {
                    const profilingCsvPath = generateCSVFileNamePath(
                        profile,
                        index
                    );

                    const projectFilePath = generateDefaultProjectPath(profile);
                    writeFileSync(
                        profilingCsvPath,
                        `Seconds,Current(A),Voltage(V),Temperature(C)\r\n`
                    );

                    dispatch(
                        atomicUpdateProjectSettings(
                            generateDefaultProjectPath(profile),
                            profileSettings => {
                                profileSettings.profiles[index].csvReady =
                                    false;
                                profileSettings.profiles[index].csvPath =
                                    path.relative(
                                        projectFilePath,
                                        profilingCsvPath
                                    );
                                return profileSettings;
                            }
                        )
                    );

                    dispatch(setProfilingStage('Profiling'));
                    timeOffset.current = event.timestamp;
                } else if (profilingStage === 'Profiling') {
                    const mAhConsumed =
                        (Math.abs(event.data.iLoad) * REPORTING_RATE) / 3600;
                    dispatch(incrementCapacityConsumed(mAhConsumed));

                    const profilingCsvPath = generateCSVFileNamePath(
                        profile,
                        index
                    );

                    const data = `${
                        (event.timestamp - timeOffset.current) / 1000
                    },${event.data.iLoad},${event.data.vLoad},${
                        event.data.tBat
                    }\r\n`;

                    appendFile(profilingCsvPath, data, () => {});
                }
            }),
        [dispatch, index, npmDevice, profile, profilingStage]
    );

    useEffect(() => {
        if (profilingStage === 'Resting' || profilingStage === 'Profiling') {
            if (usbPowered) {
                npmDevice?.setAutoRebootDevice(true);
                npmDevice?.getBatteryProfiler()?.stopProfiling();
                dispatch(
                    setCompleteStep({
                        level: 'danger',
                        message: ` The profiling process was interrupted, as USB PMIC was connected while ${profilingStage}.`,
                    })
                );
            } else if (fuelGauge) {
                npmDevice?.setAutoRebootDevice(true);
                npmDevice?.getBatteryProfiler()?.stopProfiling();
                dispatch(
                    setCompleteStep({
                        level: 'danger',
                        message: ` The profiling process was interrupted, as Fuel Gauge was turned on while ${profilingStage}.`,
                    })
                );
            } else if (!batteryConnected) {
                npmDevice?.setAutoRebootDevice(true);
                npmDevice?.getBatteryProfiler()?.stopProfiling();
                dispatch(
                    setCompleteStep({
                        level: 'danger',
                        message: `  The profiling process was interrupted, as battery was disconnected while ${profilingStage}.`,
                    })
                );
            } else if (ldos.filter(ldo => ldo.enabled).length > 0) {
                npmDevice?.setAutoRebootDevice(true);
                npmDevice?.getBatteryProfiler()?.stopProfiling();
                dispatch(
                    setCompleteStep({
                        level: 'danger',
                        message: ` The profiling process was interrupted, as LDO was enabled while ${profilingStage}.`,
                    })
                );
            } else if (bucks.length && bucks[0].enabled) {
                npmDevice?.setAutoRebootDevice(true);
                npmDevice?.getBatteryProfiler()?.stopProfiling();
                dispatch(
                    setCompleteStep({
                        level: 'danger',
                        message: ` The profiling process was interrupted, as Buck was enabled while ${profilingStage}.`,
                    })
                );
            }
        }
    }, [
        batteryConnected,
        bucks,
        dispatch,
        fuelGauge,
        ldos,
        npmDevice,
        profilingStage,
        usbPowered,
    ]);

    useEffect(() => {
        switch (ccProfilingState) {
            case 'Ready':
                dispatch(
                    setCompleteStep({
                        message:
                            'Profiling is ready. All profiling cycles complete.',
                        level: 'success',
                    })
                );
                dispatch(markProfilersAsReady());
                break;
            case 'ThermalError':
                dispatch(
                    setCompleteStep({
                        level: 'danger',
                        message: 'Profiling was stopped due to thermal error.',
                    })
                );
                break;
            case 'vCutOff':
                dispatch(
                    setCompleteStep({
                        level: 'success',
                        message: 'Profiling is ready. vCutOff was reached.',
                    })
                );
                dispatch(markProfilersAsReady());
                break;
            case 'POF':
                if (profilingStage === 'Profiling') {
                    dispatch(
                        setCompleteStep({
                            level: 'warning',
                            message:
                                'Profiling POF event occurred before reaching vCutOff.',
                        })
                    );
                } else if (profilingStage === 'Resting') {
                    dispatch(
                        setCompleteStep({
                            level: 'danger',
                            message:
                                'Profiling POF event occurred before reaching vCutOff.',
                        })
                    );
                }
                break;
        }
    }, [ccProfilingState, dispatch, profilingStage]);

    return (
        <div>
            {abortAction && (
                <ConfirmationDialog
                    title="Aborting profiling"
                    isVisible
                    onConfirm={() => {
                        abortAction();
                        dispatch(clearAbortAction());
                    }}
                    onCancel={() => {
                        dispatch(clearAbortAction());
                    }}
                >
                    <Alert variant="warning" label="Caution: ">
                        Aborting profiling now will terminate the ongoing step
                        and close this profiling session. Progress will be lost.
                        Are you sure you want to abort profiling?
                    </Alert>
                </ConfirmationDialog>
            )}
            {profilingStage === 'MissingSyncBoard' && (
                <PreConfigurationDialog />
            )}
            {profilingStage === 'Configuration' && (
                <ConfigurationDialog
                    isVisible={!abortAction && !showCloseAppDialog}
                />
            )}
            {profilingStage === 'Checklist' && (
                <ChecklistDialog
                    isVisible={!abortAction && !showCloseAppDialog}
                />
            )}
            {profilingStage === 'Charging' && (
                <ChargingDialog
                    isVisible={!abortAction && !showCloseAppDialog}
                />
            )}
            {profilingStage === 'Resting' && (
                <RestingDialog
                    isVisible={!abortAction && !showCloseAppDialog}
                />
            )}
            {profilingStage === 'Profiling' && (
                <ProfilingDialog
                    isVisible={!abortAction && !showCloseAppDialog}
                />
            )}
            {profilingStage === 'Complete' && (
                <CompleteDialog
                    isVisible={!abortAction && !showCloseAppDialog}
                />
            )}
        </div>
    );
};
