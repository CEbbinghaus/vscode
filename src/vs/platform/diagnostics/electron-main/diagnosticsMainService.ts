/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event as IpcEvent, ipcMain } from 'electron';
import { CancellationToken } from 'vs/base/common/cancellation';
import { URI } from 'vs/base/common/uri';
import { IDiagnosticInfo, IDiagnosticInfoOptions, IRemoteDiagnosticError, IRemoteDiagnosticInfo } from 'vs/platform/diagnostics/common/diagnostics';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ICodeWindow, IWindowsMainService } from 'vs/platform/windows/electron-main/windows';
import { isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier } from 'vs/platform/workspace/common/workspace';
import { IWorkspacesManagementMainService } from 'vs/platform/workspaces/electron-main/workspacesManagementMainService';

export const ID = 'diagnosticsMainService';
export const IDiagnosticsMainService = createDecorator<IDiagnosticsMainService>(ID);

export interface IRemoteDiagnosticOptions {
	includeProcesses?: boolean;
	includeWorkspaceMetadata?: boolean;
}

export interface IDiagnosticsMainService {
	readonly _serviceBrand: undefined;
	getRemoteDiagnostics(options: IRemoteDiagnosticOptions): Promise<(IRemoteDiagnosticInfo | IRemoteDiagnosticError)[]>;
}

export class DiagnosticsMainService implements IDiagnosticsMainService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@IWorkspacesManagementMainService private readonly workspacesManagementMainService: IWorkspacesManagementMainService
	) { }

	async getRemoteDiagnostics(options: IRemoteDiagnosticOptions): Promise<(IRemoteDiagnosticInfo | IRemoteDiagnosticError)[]> {
		const windows = this.windowsMainService.getWindows();
		const diagnostics: Array<IDiagnosticInfo | IRemoteDiagnosticError | undefined> = await Promise.all(windows.map(window => {
			return new Promise<IDiagnosticInfo | IRemoteDiagnosticError | undefined>((resolve) => {
				const remoteAuthority = window.remoteAuthority;
				if (remoteAuthority) {
					const replyChannel = `vscode:getDiagnosticInfoResponse${window.id}`;
					const args: IDiagnosticInfoOptions = {
						includeProcesses: options.includeProcesses,
						folders: options.includeWorkspaceMetadata ? this.getFolderURIs(window) : undefined
					};

					window.sendWhenReady('vscode:getDiagnosticInfo', CancellationToken.None, { replyChannel, args });

					ipcMain.once(replyChannel, (_: IpcEvent, data: IRemoteDiagnosticInfo) => {
						// No data is returned if getting the connection fails.
						if (!data) {
							resolve({ hostName: remoteAuthority, errorMessage: `Unable to resolve connection to '${remoteAuthority}'.` });
						}

						resolve(data);
					});

					setTimeout(() => {
						resolve({ hostName: remoteAuthority, errorMessage: `Connection to '${remoteAuthority}' could not be established` });
					}, 5000);
				} else {
					resolve(undefined);
				}
			});
		}));

		return diagnostics.filter((x): x is IRemoteDiagnosticInfo | IRemoteDiagnosticError => !!x);
	}

	private getFolderURIs(window: ICodeWindow): URI[] {
		const folderURIs: URI[] = [];

		const workspace = window.openedWorkspace;
		if (isSingleFolderWorkspaceIdentifier(workspace)) {
			folderURIs.push(workspace.uri);
		} else if (isWorkspaceIdentifier(workspace)) {
			const resolvedWorkspace = this.workspacesManagementMainService.resolveLocalWorkspaceSync(workspace.configPath); // workspace folders can only be shown for local (resolved) workspaces
			if (resolvedWorkspace) {
				const rootFolders = resolvedWorkspace.folders;
				rootFolders.forEach(root => {
					folderURIs.push(root.uri);
				});
			} else {
				//TODO@RMacfarlane: can we add the workspace file here?
			}
		}

		return folderURIs;
	}
}
