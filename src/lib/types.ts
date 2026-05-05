export type MessageType =
  | 'text'
  | 'media'
  | 'file-offer'
  | 'file-accept'
  | 'call-offer'
  | 'call-answer'
  | 'ice-candidate'
  | 'call-end'
  | 'edit'
  | 'delete';

export interface StructuredMessage {
  type: MessageType;
  content: string;
  metadata?: {
    fileName?: string;
    mimeType?: string;
    size?: number;
    fileId?: string;
    targetId?: string;
  };
}

export function parseMessage(plaintext: string): StructuredMessage {
  try {
    const parsed = JSON.parse(plaintext);
    if (parsed.type && typeof parsed.content === 'string') {
      return parsed as StructuredMessage;
    }
  } catch {
    // legacy text message fallback
  }
  return {
    type: 'text',
    content: plaintext,
  };
}
