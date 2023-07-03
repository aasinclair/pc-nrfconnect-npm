/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { dialog, getCurrentWindow } from '@electron/remote';
import {
    OpenDialogOptions,
    OpenDialogReturnValue,
    SaveDialogOptions,
} from 'electron';
import Store from 'electron-store';
import fs from 'fs';
import path from 'path';
import { AppThunk } from 'pc-nrfconnect-shared';

import { NpmExport } from '../features/pmicControl/npm/types';

const saveSettings =
    (filePath: string): AppThunk =>
    (_dispatch, getState) => {
        const currentState = getState().app.pmicControl;

        if (!currentState.npmDevice) return;

        const pathObject = path.parse(filePath);
        const store = new Store<NpmExport>({
            cwd: pathObject.dir,
            name: pathObject.name,
        });

        const out: NpmExport = {
            chargers: [...currentState.chargers],
            bucks: [...currentState.bucks],
            ldos: [...currentState.ldos],
            fuelGauge: currentState.fuelGauge,
            firmwareVersion: currentState.npmDevice.getSupportedVersion(),
            deviceType: currentState.npmDevice.getDeviceType(),
            fuelGaugeChargingSamplingRate:
                currentState.fuelGaugeChargingSamplingRate,
        };

        store.set(out);
    };

const parseFile =
    (filePath: string): AppThunk =>
    (_dispatch, getState) => {
        const currentState = getState().app.pmicControl;

        const pathObject = path.parse(filePath);
        if (pathObject.ext === '.json') {
            const store = new Store<NpmExport>({
                cwd: pathObject.dir,
                name: pathObject.name,
            });

            const config = store.store;
            currentState.npmDevice?.applyConfig(config);
        }
    };

export const showOpenDialog = (options: OpenDialogOptions) =>
    dialog.showOpenDialog(getCurrentWindow(), options);

export const showSaveDialog = (options: SaveDialogOptions) =>
    dialog.showSaveDialog(getCurrentWindow(), options);

export const loadConfiguration = (): AppThunk => dispatch => {
    showOpenDialog({
        title: 'Select a JSON file',
        filters: [
            {
                name: 'JSON',
                extensions: ['json'],
            },
        ],
        properties: ['openFile'],
    }).then(
        ({ filePaths }: OpenDialogReturnValue) =>
            filePaths.length === 1 && dispatch(parseFile(filePaths[0]))
    );
};

const stream2buffer = (stream: fs.ReadStream) =>
    new Promise<Buffer>((resolve, reject) => {
        let buf = '';

        stream.on('data', chunk => {
            buf += chunk.toString();
        });
        stream.on('end', () =>
            resolve(
                Buffer.from(buf.replaceAll('\\s', '').replaceAll('\r\n', ''))
            )
        );
        stream.on('error', err =>
            reject(new Error(`error converting stream - ${err}`))
        );
    });

const loadBatteryProfile = (filePath: string) =>
    new Promise<Buffer>((resolve, reject) => {
        const readerStream = fs.createReadStream(filePath);
        readerStream.setEncoding('utf8');

        stream2buffer(readerStream).then(resolve).catch(reject);
    });

export const getProfileBuffer = () =>
    new Promise<Buffer>((resolve, reject) => {
        showOpenDialog({
            title: 'Select a JSON file',
            filters: [
                {
                    name: 'JSON',
                    extensions: ['json'],
                },
            ],
            properties: ['openFile'],
        }).then(({ filePaths }: OpenDialogReturnValue) => {
            filePaths.length === 1 &&
                loadBatteryProfile(filePaths[0]).then(resolve).catch(reject);
        });
    });

export const selectDirectoryDialog = () =>
    new Promise<string>((resolve, reject) => {
        const dialogOptions = {
            title: 'Select a Directory',
            properties: ['openDirectory'],
            // eslint-disable-next-line no-undef
        } as Electron.OpenDialogOptions;
        showOpenDialog(dialogOptions)
            .then(({ filePaths }: { filePaths: string[] }) => {
                if (filePaths.length === 1) {
                    resolve(filePaths[0]);
                }
            })
            .catch(reject);
    });

export const saveFileDialog = (): AppThunk => dispatch => {
    showSaveDialog({
        title: 'Save Device Settings',
        filters: [
            {
                name: 'JSON',
                extensions: ['json'],
            },
        ],
    }).then(
        result =>
            !result.canceled &&
            result.filePath &&
            dispatch(saveSettings(result.filePath))
    );
};
