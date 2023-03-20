/*
 * Copyright (c) 2022 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Alert, PaneProps } from 'pc-nrfconnect-shared';

import { getPmicState } from '../../features/pmicControl/pmicControlSlice';
import { isPaused } from '../../features/serial/serialSlice';
import DashboardControlCard from './DasboardControlCard';

import './dashboardControl.scss';

export default ({ active }: PaneProps) => {
    const paused = useSelector(isPaused);

    const pmicState = useSelector(getPmicState);

    const [pauseFor1Second, setPauseFor1Second] = useState(paused);
    const disabled =
        pmicState === 'pmic-disconnected' ||
        pmicState === 'pmic-unknown' ||
        pauseFor1Second;

    useEffect(() => {
        if (!paused) {
            setPauseFor1Second(paused);
        } else {
            const t = setTimeout(() => {
                setPauseFor1Second(paused);
            }, 5000);

            return () => clearTimeout(t);
        }
    }, [paused]);

    return !active ? null : (
        <div className="pmicControl-container">
            <div className="pmicControl">
                <Alert
                    variant="info"
                    label="nPM PowerUP​ 0.1​ - Preview release! "
                >
                    This is an unsupported, experimental preview and it is
                    subject to major redesigns in the future.
                </Alert>
                ``
                <div className="pmicControl-cards">
                    <DashboardControlCard disabled={disabled} />
                </div>
            </div>
        </div>
    );
};
