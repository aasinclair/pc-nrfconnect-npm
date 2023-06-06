/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import Store from 'electron-store';
import fs from 'fs';
import path from 'path';
import { describeError, getAppDir, logger } from 'pc-nrfconnect-shared';

import { RootState } from '../../appReducer';
import { Profile } from '../../features/pmicControl/npm/types';
import {
    addRecentProject,
    loadRecentProject,
    setRecentProjects,
    updateProfilingProject,
} from '../../features/pmicControl/profilingProjectsSlice.';
import { TDispatch } from '../../thunk';
import {
    ProfilingProject,
    ProfilingProjectProfile,
    ProjectPathPair,
} from './types';

export const REST_DURATION = 900; // seconds
export const REPORTING_RATE = 1000;
export const PROFILE_FOLDER_PREFIX = 'profile_';
const LOCK_FILE = path.join(getAppDir(), 'profiling.lock');

const acquireFileLock = (lockFile: string): Promise<() => void> =>
    new Promise((resolve, reject) => {
        fs.open(lockFile, 'w', (err, fd) => {
            if (err) {
                setTimeout(
                    () => acquireFileLock(lockFile).then(resolve, reject),
                    10
                );
            } else {
                resolve(() => {
                    fs.closeSync(fd);
                    fs.unlinkSync(lockFile);
                });
            }
        });
    });

export const generateDefaultProjectPath = (profile: Profile) =>
    path.join(profile.baseDirectory, profile.name, 'profileSettings.json');

export const isProfileReadyForProcessing = (
    projectSettingsPath: string,
    profile: ProfilingProjectProfile
) =>
    !(
        !profile.csvPath ||
        !profile.csvReady ||
        !fs.existsSync(path.resolve(projectSettingsPath, profile.csvPath))
    );

const guaranteeValidCsvPath = (csvPath: string) =>
    csvPath.replace(
        new RegExp([`\\${path.win32.sep}`, path.posix.sep].join('|'), 'g'),
        path.sep
    );

const updateStoreWithValidCsvPath = (store: Store<ProfilingProject>) =>
    store.set({
        ...store.store,
        profiles: store.store.profiles.map(profile => ({
            ...profile,
            csvPath: guaranteeValidCsvPath(profile.csvPath as string),
        })),
    });

export const readProjectSettingsFromFile = (
    filePath: string
): Omit<ProjectPathPair, 'path'> => {
    if (!fs.existsSync(filePath)) {
        return { settings: undefined, error: 'fileMissing' };
    }

    try {
        const pathObject = path.parse(filePath);
        if (pathObject.ext === '.json') {
            const store = new Store<ProfilingProject>({
                cwd: pathObject.dir,
                name: pathObject.name,
            });

            updateStoreWithValidCsvPath(store);

            return { settings: store.store };
        }
    } catch (error) {
        return { settings: undefined, error: 'fileCorrupted' };
    }

    return { settings: undefined, error: 'fileCorrupted' };
};

export const atomicUpdateProjectSettings =
    (
        filePath: string,
        updateProject: (currentProject: ProfilingProject) => ProfilingProject
    ) =>
    async (dispatch: TDispatch) => {
        const releaseFileLock = await acquireFileLock(LOCK_FILE);
        const pathObject = path.parse(filePath);
        const store = new Store<ProfilingProject>({
            cwd: pathObject.dir,
            name: pathObject.name,
        });

        const oldProject = store.store;

        if (oldProject) {
            try {
                updateStoreWithValidCsvPath(store);
                const newProject = updateProject(oldProject);
                store.set(newProject);
                dispatch(
                    updateProfilingProject({
                        path: filePath,
                        settings: newProject,
                    })
                );
            } catch (error) {
                logger.error(describeError(error));
            }
        }
        releaseFileLock();
    };

export const saveProjectSettings =
    (filePath: string, project: ProfilingProject) =>
    (dispatch: TDispatch, getState: () => RootState) => {
        const pathObject = path.parse(filePath);
        const store = new Store<ProfilingProject>({
            cwd: pathObject.dir,
            name: pathObject.name,
        });

        store.set(project);

        // Abort any ongoing processes with the same project file name
        getState()
            .app.profilingProjects.profilingCSVProgress.filter(
                progress => progress.path === filePath
            )
            .forEach(progress => progress.cancel());

        dispatch(addRecentProject(filePath));
    };

export const reloadRecentProjects = () => (dispatch: TDispatch) =>
    dispatch(setRecentProjects(loadRecentProject()));
