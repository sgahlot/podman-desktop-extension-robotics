module.exports = {
  provider: {
    createProvider: vi.fn(),
  },
  window: {
    createWebviewPanel: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  commands: {
    registerCommand: vi.fn(),
  },
  Uri: {
    joinPath: vi.fn(),
  },
  Disposable: {
    create: vi.fn(),
  },
};
