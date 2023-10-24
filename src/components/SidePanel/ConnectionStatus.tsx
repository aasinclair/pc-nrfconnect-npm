/*
 * Copyright (c) 2023 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    CollapsibleGroup,
    getWaitingForDeviceTimeout,
    Step,
    Stepper,
} from '@nordicsemiconductor/pc-nrfconnect-shared';

import {
    getErrorLogs,
    getNpmDevice,
    getPmicState,
    getUsbPower,
    isBatteryConnected,
    isSupportedVersion,
} from '../../features/pmicControl/pmicControlSlice';
import { getCcProfilingState } from '../../features/pmicControl/profilingSlice';
import {
    getShellParser,
    isPaused,
    setIsPaused,
} from '../../features/serial/serialSlice';

export default () => {
    const shellParser = useSelector(getShellParser);
    const pmicState = useSelector(getPmicState);
    const supportedVersion = useSelector(isSupportedVersion);
    const usbPower = useSelector(getUsbPower);
    const usbPowered = usbPower.detectStatus !== 'No USB connection';
    const paused = useSelector(isPaused);
    const ccProfilingState = useSelector(getCcProfilingState);
    const npmDevice = useSelector(getNpmDevice);
    const waitingForDevice = useSelector(getWaitingForDeviceTimeout);
    const batteryConnected = useSelector(isBatteryConnected);
    const errorLogs = useSelector(getErrorLogs);
    const dispatch = useDispatch();

    const [pauseFor10Ms, setPauseFor100ms] = useState(paused);

    useEffect(() => {
        const t = setTimeout(() => {
            setPauseFor100ms(paused);
        }, 100);

        return () => clearTimeout(t);
    }, [paused]);

    const connectionStep: Step = {
        id: '1',
        title: 'CONNECTION',
        caption: 'Offline Mode',
    };
    const shellStep: Step = {
        id: '2',
        title: 'SHELL',
    };
    const pmicStep: Step = {
        id: '3',
        title: 'PMIC',
    };

    if (waitingForDevice) {
        connectionStep.caption = 'Rebooting...';
        connectionStep.state = 'active';
    } else if (pmicState !== 'ek-disconnected' || waitingForDevice) {
        connectionStep.caption = 'Connected to EK';
        connectionStep.state = 'success';

        shellStep.caption = 'Shell is free';
        shellStep.state = 'success';

        if (pauseFor10Ms) {
            shellStep.state = 'warning';
            shellStep.caption = [
                { id: '1', caption: 'Shell is busy' },
                {
                    id: '2',
                    caption: 'unpause',
                    action: () => shellParser?.unPause(),
                },
            ];

            if (ccProfilingState !== 'Running') {
                pmicStep.caption = 'Waiting on shell';
                pmicStep.state = 'active';
            } else {
                pmicStep.caption = [
                    { id: '1', caption: 'Profiling Battery' },
                    {
                        id: '2',
                        caption: 'stop profiling',
                        action: () =>
                            npmDevice?.getBatteryProfiler()?.stopProfiling(),
                    },
                ];
                pmicStep.state = 'warning';
            }
        } else if (supportedVersion === false) {
            shellStep.state = 'failure';
            shellStep.caption = 'Wrong firmware';
        } else if (supportedVersion === undefined) {
            shellStep.state = 'warning';
            shellStep.caption = [
                { id: '1', caption: 'Unknown firmware' },
                {
                    id: '2',
                    caption: 'check again',
                    action: () =>
                        npmDevice
                            ?.isSupportedVersion()
                            .then(result =>
                                dispatch(setIsPaused(result.supported))
                            ),
                },
            ];
        } else if (pmicState === 'pmic-disconnected') {
            pmicStep.caption = 'Not powered';
            pmicStep.state = 'failure';
        } else if (ccProfilingState !== 'Off') {
            pmicStep.caption = [{ id: '1', caption: 'Profiling Battery' }];

            if (!pauseFor10Ms)
                pmicStep.caption.push({
                    id: '2',
                    caption: 'stop profiling',
                    action: () =>
                        npmDevice?.getBatteryProfiler()?.stopProfiling(),
                });
            pmicStep.state = 'warning';
        } else if (pmicState === 'pmic-pending-reboot') {
            pmicStep.caption = [
                { id: '1', caption: 'Pending device restart' },
                {
                    id: '2',
                    caption: 'reset device',
                    action: () => npmDevice?.kernelReset(),
                },
            ];
            pmicStep.state = 'warning';
        } else if (
            errorLogs &&
            ((errorLogs.sensorError && errorLogs.sensorError.length > 0) ||
                (errorLogs.sensorError && errorLogs.sensorError.length > 0))
        ) {
            pmicStep.caption = [
                {
                    id: '1',
                    caption:
                        "Errors detected. Check 'System Features' tab for more information",
                },
                {
                    id: '2',
                    caption: 'clear error log',
                    action: () => npmDevice?.clearErrorLogs(true),
                },
            ];
            pmicStep.state = 'failure';
        } else if (!usbPowered) {
            pmicStep.caption =
                'Not powered by USB PMIC. Charging is not possible';
            pmicStep.state = 'warning';
        } else if (!batteryConnected) {
            pmicStep.caption = 'Battery not detected';
            pmicStep.state = 'warning';
        } else {
            pmicStep.state = 'success';
            pmicStep.caption = 'In sync';
        }
    }

    return (
        <CollapsibleGroup heading="Connection Status" defaultCollapsed={false}>
            <div className="connection-status-container">
                <Stepper steps={[connectionStep, shellStep, pmicStep]} />
            </div>
        </CollapsibleGroup>
    );
};
