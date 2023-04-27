/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import EventEmitter from 'events';

import { ShellParser } from '../../../hooks/commandParser';
import { noop, parseLogData, toRegex } from './pmicHelpers';
import {
    IBatteryProfiler,
    LoggingEvent,
    Profile,
    ProfilingEvent,
} from './types';

export const BatteryProfiler: IBatteryProfiler = (
    shellParser: ShellParser,
    eventEmitter: EventEmitter
) => {
    const processModuleCcProfiling = ({ message }: LoggingEvent) => {
        const messageParts = message.split(',');
        const event: ProfilingEvent = {
            iLoad: 0,
            vLoad: 0,
            tBat: 0,
            cycle: 0,
            seq: 0,
            chg: 0,
            rep: 0,
            t0: 0,
            t1: 0,
        };
        messageParts.forEach(part => {
            const pair = part.split('=');
            switch (pair[0]) {
                case 'iload':
                    event.iLoad = Number.parseInt(pair[1], 10);
                    break;
                case 'vload':
                    event.vLoad = Number.parseInt(pair[1], 10);
                    break;
                case 'tbat':
                    event.tBat = Number.parseInt(pair[1], 10);
                    break;
                case 'cycle':
                    event.cycle = Number.parseInt(pair[1], 10);
                    break;
                case 'seq':
                    event.seq = Number.parseInt(pair[1], 10);
                    break;
                case 'chg':
                    event.chg = Number.parseInt(pair[1], 10);
                    break;
                case 'rep':
                    event.rep = Number.parseInt(pair[1], 10);
                    break;
                case 't0':
                    event.t0 = Number.parseInt(pair[1], 10);
                    break;
                case 't1':
                    event.t1 = Number.parseInt(pair[1], 10);
                    break;
            }
        });

        eventEmitter.emit('onProfilingEvent', event);
    };

    shellParser?.registerCommandCallback(
        toRegex('cc_profile start'),
        () => {
            eventEmitter.emit('onProfilingStateChange', true);
        },
        noop
    );

    shellParser?.registerCommandCallback(
        toRegex('cc_profile stop'),
        () => {
            eventEmitter.emit('onProfilingStateChange', false);
        },
        noop
    );

    shellParser?.onShellLoggingEvent(logEvent => {
        parseLogData(logEvent, loggingEvent => {
            if (loggingEvent.module === 'module_cc_profiling') {
                processModuleCcProfiling(loggingEvent);
            }
        });
    });

    const setProfile = (
        reportIntervalCc: number,
        reportIntervalNtc: number,
        vCutoff: number,
        profiles: Profile[]
    ) =>
        new Promise<void>((resolve, reject) => {
            const profilesString = profiles.map(
                profile =>
                    `"${profile.tLoad},${profile.tRest},${profile.iLoad},${
                        profile.iRest
                    },${profile.cycles ? `${profile.cycles}` : 'NaN'}${
                        profile.vCutoff ? `,${profile.vCutoff}` : ''
                    }"`
            );

            shellParser?.enqueueRequest(
                `cc_profile profile set ${reportIntervalCc} ${reportIntervalNtc} ${vCutoff} ${profilesString.join(
                    ' '
                )} --print`,
                {
                    onSuccess: () => {
                        resolve();
                    },
                    onError: reject,
                }
            );
        });

    const startProfiling = () =>
        new Promise<void>((resolve, reject) => {
            shellParser?.enqueueRequest('cc_profile start', {
                onSuccess: () => {
                    resolve();
                },
                onError: reject,
            });
        });

    const stopProfiling = () =>
        new Promise<void>((resolve, reject) => {
            shellParser?.enqueueRequest('cc_profile stop', {
                onSuccess: () => {
                    resolve();
                },
                onError: reject,
            });
        });

    const isProfiling = () =>
        new Promise<boolean>(resolve => {
            resolve(true);
        });

    return {
        setProfile,
        startProfiling,
        stopProfiling,
        isProfiling,
        onProfilingStateChange: (handler: (state: boolean) => void) => {
            eventEmitter.on('onProfilingStateChange', handler);
            return () => {
                eventEmitter.removeListener('onProfilingStateChange', handler);
            };
        },
        onProfilingEvent: (handler: (state: ProfilingEvent) => void) => {
            eventEmitter.on('onProfilingEvent', handler);
            return () => {
                eventEmitter.removeListener('onProfilingEvent', handler);
            };
        },
    };
};
