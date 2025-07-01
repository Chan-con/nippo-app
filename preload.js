const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  addTask: (taskName) => ipcRenderer.invoke('add-task', taskName),
  endTask: () => ipcRenderer.invoke('end-task'),
  copyTimeline: () => ipcRenderer.invoke('copy-timeline'),
  clearAllTasks: () => ipcRenderer.invoke('clear-all-tasks'),
  updateTask: (taskId, taskData) => ipcRenderer.invoke('update-task', taskId, taskData),
  deleteTask: (taskId) => ipcRenderer.invoke('delete-task', taskId),
  healthCheck: () => ipcRenderer.invoke('health-check'),
  getReport: () => ipcRenderer.invoke('get-report'),
  saveReport: (content) => ipcRenderer.invoke('save-report', content)
});