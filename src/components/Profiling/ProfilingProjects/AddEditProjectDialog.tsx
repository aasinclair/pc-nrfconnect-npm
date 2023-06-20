/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useState } from 'react';
import FormLabel from 'react-bootstrap/FormLabel';
import { useDispatch } from 'react-redux';
import {
    classNames,
    DialogButton,
    GenericDialog,
    Group,
    NumberInlineInput,
    Slider,
} from 'pc-nrfconnect-shared';

import { showSaveDialog } from '../../../actions/fileActions';
import { DocumentationTooltip } from '../../../features/pmicControl/npm/documentation/documentation';
import { readAndUpdateProjectSettings, saveProjectSettings } from '../helpers';
import { ProfilingProject } from '../types';

import '../profiling.scss';

export default ({
    projectSettings,
    onClose,
}: {
    projectSettings?: {
        project: ProfilingProject;
        projectSettingsPath: string;
    };
    onClose: () => void;
}) => {
    const [validName, setValidName] = useState(!!projectSettings);
    const [name, setName] = useState(projectSettings?.project.name ?? '');

    const [vLowerCutOff, setLowerVCutOff] = useState(
        projectSettings?.project.vLowerCutOff ?? 3
    );
    const [vUpperCutOff, setUpperVCutOff] = useState(
        projectSettings?.project.vUpperCutOff ?? 4.2
    );

    const [capacity, setCapacity] = useState(800);
    const dispatch = useDispatch();
    const maxLength = 20;

    return (
        <GenericDialog
            title={`${projectSettings ? 'Edit' : 'Add'} Project ${
                name.length > 0 ? `- ${name}` : ''
            }`}
            isVisible
            size="sm"
            className="app-dialog"
            closeOnEsc={false}
            footer={
                <>
                    <DialogButton
                        variant="primary"
                        disabled={!validName}
                        onClick={() => {
                            if (projectSettings) {
                                dispatch(
                                    readAndUpdateProjectSettings(
                                        projectSettings.projectSettingsPath,
                                        currentProject => ({
                                            ...currentProject,
                                            name,
                                            capacity,
                                            vLowerCutOff,
                                            vUpperCutOff,
                                        })
                                    )
                                );
                            } else {
                                showSaveDialog({
                                    title: 'New Project',
                                    defaultPath: `profileSettings.json`,
                                    filters: [
                                        {
                                            name: 'JSON',
                                            extensions: ['json'],
                                        },
                                    ],
                                }).then(result => {
                                    if (!result.canceled && result.filePath) {
                                        if (result.filePath)
                                            dispatch(
                                                saveProjectSettings(
                                                    result.filePath,
                                                    {
                                                        name,
                                                        capacity,
                                                        vLowerCutOff,
                                                        vUpperCutOff,
                                                        profiles: [],
                                                    }
                                                )
                                            );
                                    }
                                });
                            }
                            onClose();
                        }}
                    >
                        Save
                    </DialogButton>

                    <DialogButton onClick={onClose}>Cancel</DialogButton>
                </>
            }
        >
            <Group>
                <div
                    className={classNames(
                        'name-input',
                        !validName && 'invalid'
                    )}
                >
                    <div className="max-length">{`${name.length}/${maxLength}`}</div>
                    <input
                        maxLength={maxLength}
                        placeholder="Name your battery"
                        onChange={event => {
                            setName(event.target.value);
                            const match =
                                event.target.value.match(/^[a-zA-Z0-9]+$/);
                            setValidName(!!match);
                        }}
                        value={name}
                    />
                </div>

                <div className="slider-container">
                    <FormLabel className="flex-row">
                        <div>
                            <span>Capacity</span>
                        </div>
                        <div className="flex-row">
                            <NumberInlineInput
                                value={capacity}
                                range={{ min: 32, max: 3000 }}
                                onChange={setCapacity}
                            />
                            <span>mAh</span>
                        </div>
                    </FormLabel>
                    <Slider
                        values={[capacity]}
                        onChange={[setCapacity]}
                        range={{ min: 32, max: 3000 }}
                    />
                </div>
                <div className="slider-container">
                    <FormLabel className="flex-row">
                        <DocumentationTooltip card="charger" item="VTERM">
                            <div>
                                <span>V</span>
                                <span className="subscript">TERM</span>
                            </div>
                        </DocumentationTooltip>
                        <div className="flex-row">
                            <NumberInlineInput
                                value={vUpperCutOff}
                                range={{
                                    min: 4,
                                    max: 4.4,
                                    step: 0.05,
                                    decimals: 2,
                                }}
                                onChange={setUpperVCutOff}
                            />
                            <span>V</span>
                        </div>
                    </FormLabel>
                    <Slider
                        values={[vUpperCutOff]}
                        onChange={[setUpperVCutOff]}
                        range={{
                            min: 4,
                            max: 4.4,
                            step: 0.05,
                            decimals: 2,
                        }}
                    />
                </div>
                <div className="slider-container">
                    <FormLabel className="flex-row">
                        <DocumentationTooltip card="profiling" item="Capacity">
                            <div>
                                <span>Discharge cut-off voltage</span>
                            </div>
                        </DocumentationTooltip>
                        <div className="flex-row">
                            <NumberInlineInput
                                value={vLowerCutOff}
                                range={{
                                    min: 2.7,
                                    max: 3.1,
                                    step: 0.05,
                                    decimals: 2,
                                }}
                                onChange={setLowerVCutOff}
                            />
                            <span>V</span>
                        </div>
                    </FormLabel>
                    <Slider
                        values={[vLowerCutOff]}
                        onChange={[setLowerVCutOff]}
                        range={{
                            min: 2.7,
                            max: 3.1,
                            step: 0.05,
                            decimals: 2,
                        }}
                    />
                </div>
            </Group>
        </GenericDialog>
    );
};
