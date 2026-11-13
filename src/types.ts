export interface WahaMessageMedia {
  url?: string | null;
  mimetype?: string | null;
  filename?: string | null;
}

export interface WahaMessagePayload {
  id: string;
  from: string;
  to?: string | null;
  fromMe: boolean;
  body?: string | null;
  caption?: string | null;
  participant?: string | null;
  source?: string | null;
  hasMedia?: boolean;
  media?: WahaMessageMedia | null;
}

export interface WahaMessageEvent {
  id?: string;
  timestamp?: number;
  event: string;
  session: string;
  payload: WahaMessagePayload;
}

export interface WahaClientPort {
  sendSeen?(params: {
    chatId: string;
    messageId?: string;
    participant?: string;
  }): Promise<void>;
  sendReaction(messageId: string, emoji: string): Promise<void>;
  sendVideo(params: {
    chatId: string;
    videoUrl: string;
    filename: string;
    caption: string;
    replyTo: string;
  }): Promise<void>;
  sendText(params: {
    chatId: string;
    text: string;
    replyTo: string;
  }): Promise<void>;
  downloadMedia(mediaUrl: string): Promise<string>;
}

export interface DownloadedMedia {
  filePath: string;
  fileSize: number;
  filename: string;
}

export interface DownloadOptions {
  cookiesFile?: string;
}

export interface DownloaderPort {
  download(
    url: string,
    outputDir: string,
    options?: DownloadOptions,
  ): Promise<DownloadedMedia>;
}

export interface ArchiveUploadLink {
  label: string;
  url: string;
}

export interface ArchiveUploadResult {
  primaryUrl: string;
  links: ArchiveUploadLink[];
}

export interface MediaArchivePort {
  upload(filePath: string, objectKey: string): Promise<string>;
  uploadAll?(filePath: string, objectKey: string): Promise<ArchiveUploadResult>;
}

export interface Logger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}
