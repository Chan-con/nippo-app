const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  addTask: (taskName, isBreak = false) => ipcRenderer.invoke('add-task', taskName, isBreak),
  endTask: () => ipcRenderer.invoke('end-task'),
  copyTimeline: () => ipcRenderer.invoke('copy-timeline'),
  clearAllTasks: () => ipcRenderer.invoke('clear-all-tasks'),
  updateTask: (taskId, taskData) => ipcRenderer.invoke('update-task', taskId, taskData),
  deleteTask: (taskId) => ipcRenderer.invoke('delete-task', taskId),
  healthCheck: () => ipcRenderer.invoke('health-check'),
  getReport: () => ipcRenderer.invoke('get-report'),
  saveReport: (content) => ipcRenderer.invoke('save-report', content),
  getReportUrls: () => ipcRenderer.invoke('get-report-urls'),
  addReportUrl: (name, url) => ipcRenderer.invoke('add-report-url', name, url),
  deleteReportUrl: (urlId) => ipcRenderer.invoke('delete-report-url', urlId),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  getReportTabs: () => ipcRenderer.invoke('get-report-tabs'),
  getReportTabContent: (tabId) => ipcRenderer.invoke('get-report-tab-content', tabId),
  saveReportTabContent: (tabId, content) => ipcRenderer.invoke('save-report-tab-content', tabId, content)
});