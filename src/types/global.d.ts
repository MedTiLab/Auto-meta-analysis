export {};

declare global {
  interface MedAutoDataDesktopBridge {
    isDesktop: boolean;
    platform: string;
    writeClipboardText?: (text: string) => Promise<boolean>;
    chooseDirectory?: (defaultPath?: string) => Promise<{ canceled?: boolean; filePath?: string }>;
    saveFile?: (payload: { defaultFileName: string; data: ArrayBuffer }) => Promise<{ canceled?: boolean; filePath?: string }>;
  }

  interface Window {
    __ROUTER_BASENAME__?: string;
    medautodataDesktop?: MedAutoDataDesktopBridge;
    refreshProjects?: () => void | Promise<void>;
    openSettings?: (tab?: string) => void;
  }
}
