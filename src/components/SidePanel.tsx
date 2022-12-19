/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { SidePanel } from 'pc-nrfconnect-shared';
import { Terminal } from 'xterm-headless';

import {
    getModem,
    getShellParser,
    setShellParser,
} from '../features/modem/modemSlice';
import { setIsPaused } from '../features/shell/shellSlice';
import useShellEffects from '../features/shell/useShellEffects';
import {
    hookModemToShellParser,
    xTerminalShellParserWrapper,
} from '../hooks/commandParser';
import SerialSettings from './SerialSettings';

const TerminalSidePanel = () => {
    const modem = useSelector(getModem);
    const shellParserO = useSelector(getShellParser);

    const dispatch = useDispatch();
    useShellEffects();

    // init shell parser
    useEffect(() => {
        const init = async () => {
            dispatch(setShellParser(undefined));

            if (modem) {
                console.log('Open Shell Parser');
                const shellParser = await hookModemToShellParser(
                    modem,
                    xTerminalShellParserWrapper(
                        new Terminal({ allowProposedApi: true })
                    ),
                    {
                        shellPromptUart: 'shell:~$ ',
                        logRegex:
                            '^[[][0-9]{2}:[0-9]{2}:[0-9]{2}.[0-9]{3},[0-9]{3}] <inf>',
                        errorRegex: '^error: ',
                    }
                );

                const relaseOnUnknowCommand = shellParser.onUnknowCommand(
                    data => {
                        console.warn(`Unkown Command:\r\n${data}`);
                    }
                );

                dispatch(setShellParser(shellParser));
                return () => {
                    relaseOnUnknowCommand();
                    shellParser.unregister();
                };
            }
        };
        init().catch(console.error);
    }, [dispatch, modem]);

    useEffect(() => {
        shellParserO?.onPausedChange(state => {
            dispatch(setIsPaused(state));
        });
    }, [dispatch, shellParserO]);

    // init data getters
    useEffect(() => {
        shellParserO?.registerCommandCallback(
            'test_version',
            response => console.log(`version 1:\r\n${response}`),
            error => console.error(`version error:\r\n${error}`)
        );
        shellParserO?.registerCommandCallback(
            'test_meas_read',
            response => console.log(`Measurment:\r\n${response}`),
            error => console.error(`Measurment error:\r\n${error}`)
        );
        shellParserO?.enqueueRequest('test_stream start 5');

        let ledState = false;

        const timer = setInterval(() => {
            if (!modem?.isOpen() || shellParserO?.isPaused()) return;

            shellParserO?.enqueueRequest(
                'test_version',
                response => console.log(`version one time:\r\n${response}`),
                error => console.error(`version error one time:\r\n${error}`)
            );
            shellParserO?.enqueueRequest('test_meas_read');
            shellParserO?.enqueueRequest(`test_led ${ledState ? 'on' : 'off'}`);
            ledState = !ledState;
        }, 2500);
        return () => clearInterval(timer);
    }, [shellParserO, modem]);

    return (
        <SidePanel className="side-panel">
            <SerialSettings />
        </SidePanel>
    );
};

export default TerminalSidePanel;
