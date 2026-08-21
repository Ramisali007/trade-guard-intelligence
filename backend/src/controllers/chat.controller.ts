import { Request, Response } from 'express';
import { getRagService, type ChatMessage } from '../services/rag.service';
import { Errors } from '../utils/errors';

export async function chatWebsite(req: Request, res: Response): Promise<void> {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw Errors.validation('messages must be a non-empty array of ChatMessage objects');
  }

  const result = await getRagService().chatPlatform(messages as ChatMessage[]);
  res.json(result);
}

export async function chatDocument(req: Request, res: Response): Promise<void> {
  const documentId = req.params['id'];
  if (!documentId) {
    throw Errors.validation('Document ID is required');
  }

  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw Errors.validation('messages must be a non-empty array of ChatMessage objects');
  }

  const result = await getRagService().chatDocument(documentId, messages as ChatMessage[]);
  res.json(result);
}
