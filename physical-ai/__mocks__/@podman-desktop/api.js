module.exports = {
  provider: {
    createProvider: vi.fn(),
    getContainerConnections: vi.fn(),
  },
  window: {
    createWebviewPanel: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  commands: {
    registerCommand: vi.fn(),
  },
  containerEngine: {
    listImages: vi.fn(),
    pullImage: vi.fn(),
    buildImage: vi.fn(),
    pushImage: vi.fn(),
  },
  configuration: {
    getConfiguration: vi.fn(),
  },
  Uri: {
    joinPath: vi.fn(),
  },
  Disposable: {
    create: vi.fn(),
  },
};
