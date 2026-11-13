export interface WahaMessagePayload {
  id: string;
  from: string;
  to?: string | null;
  fromMe: boolean;
  body?: string | null;
  caption?: string | null;
  participant?: string | null;
  source?: string | null;
}

export interface WahaMessageEvent {
  id?: string;
  timestamp?: number;
  event: string;
  session: string;
  payload: WahaMessagePayload;
}

export interface WahaClientPort {
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
}

export interface DownloadedMedia {
  filePath: string;
  fileSize: number;
  filename: string;
}

export interface DownloaderPort {
  download(url: string, outputDir: string): Promise<DownloadedMedia>;
}

export interface MediaArchivePort {
  upload(filePath: string, objectKey: string): Promise<string>;
}
