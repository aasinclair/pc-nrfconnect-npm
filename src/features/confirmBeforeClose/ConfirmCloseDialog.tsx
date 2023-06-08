/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { getCurrentWindow } from '@electron/remote';
import { ConfirmationDialog } from 'pc-nrfconnect-shared';

import { RootState } from '../../appReducer';
import { TDispatch } from '../../thunk';
import {
    addConfirmBeforeClose,
    clearConfirmBeforeClose,
    ConfirmBeforeCloseApp,
    getNextConfirmDialog,
    getShowConfirmCloseDialog,
    setShowCloseDialog,
} from './confirmBeforeCloseSlice';

export default () => {
    const dispatch = useDispatch();
    const [confirmedDialogs, setConfirmedDialogs] = useState<
        ConfirmBeforeCloseApp[]
    >([]);

    const showCloseDialog = useSelector(getShowConfirmCloseDialog);
    const nextConfirmDialog = useSelector(getNextConfirmDialog);

    useEffect(() => {
        if (!nextConfirmDialog && showCloseDialog) {
            confirmedDialogs.forEach(confirmedDialog => {
                if (confirmedDialog.onClose) confirmedDialog.onClose();
            });
            setConfirmedDialogs([]);
            getCurrentWindow().close();
        }
    }, [nextConfirmDialog, dispatch, showCloseDialog, confirmedDialogs]);

    useEffect(() => {
        const action = (ev: BeforeUnloadEvent) =>
            dispatch((_: TDispatch, getState: () => RootState) => {
                const hasToGetExplicitConform =
                    getState().app.confirmBeforeClose.confirmCloseApp.length >
                    0;
                if (hasToGetExplicitConform) {
                    dispatch(setShowCloseDialog(true));
                    ev.returnValue = true;
                }
            });

        window.addEventListener('beforeunload', action, true);

        return () => {
            window.removeEventListener('beforeunload', action);
        };
    }, [dispatch]);

    return (
        <ConfirmationDialog
            title="Closing nPM PowerUp"
            isVisible={showCloseDialog && !!nextConfirmDialog}
            onConfirm={() => {
                if (nextConfirmDialog) {
                    setConfirmedDialogs([
                        ...confirmedDialogs,
                        nextConfirmDialog,
                    ]);
                    dispatch(clearConfirmBeforeClose(nextConfirmDialog.id));
                }
            }}
            onCancel={() => {
                dispatch(setShowCloseDialog(false));
                confirmedDialogs.forEach(confirmedDialog =>
                    dispatch(addConfirmBeforeClose(confirmedDialog))
                );
                setConfirmedDialogs([]);
            }}
        >
            {`${nextConfirmDialog?.message} Any progress will be lost.
                Are you sure you want to close the app?`}
        </ConfirmationDialog>
    );
};
