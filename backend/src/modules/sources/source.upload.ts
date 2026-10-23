import { rm } from 'node:fs/promises';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { appConfig } from '../../config/app.config.js';
import logger from '../../config/logger.config.js';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { AppError, BadRequestError, PayloadTooLargeError } from '../../utils/errors/app.error.js';
import type { WorkspaceParams } from '../workspaces/workspace.dto.js';
import { assertWorkspaceAccess } from '../workspaces/workspace.service.js';

const { maxPdfBytes } = appConfig.sources;

// Streams the file to a temp file on disk (os.tmpdir(), random name), so a 50 MB upload
// doesn't sit in memory. The controller deletes it when the request is done.
const upload = multer({
  storage: multer.diskStorage({}),
  limits: { fileSize: maxPdfBytes, files: 1, fields: 5, fieldSize: 1024 },
  // Browsers send UTF-8 file names; without this multer reads them as Latin-1.
  defParamCharset: 'utf8',
  fileFilter(_req, file, accept) {
    if (!/\.pdf$/i.test(file.originalname) || file.mimetype !== 'application/pdf') {
      accept(new BadRequestError('Only PDF files are supported'));
      return;
    }
    accept(null, true);
  },
}).single('file');

/**
 * Receives one PDF in the `file` field; the bytes are checked later (magic bytes). The temp
 * file is deleted when the response closes, whichever way the request ends.
 */
export function receivePdf(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (error: unknown) => {
    if (req.file) {
      const { path } = req.file;
      const removeTempFile = () => {
        rm(path, { force: true }).catch((err: unknown) =>
          logger.warn('Could not delete upload temp file', { error: err, path }),
        );
      };
      res.on('close', removeTempFile);
      // The client may have left while the file was still being written; 'close' has fired.
      if (res.closed || res.socket?.destroyed) removeTempFile();
    }
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(new PayloadTooLargeError(`PDFs can be up to ${maxPdfBytes / 1024 / 1024} MB`));
      }
      return next(new BadRequestError(error.message));
    }
    if (error instanceof AppError) return next(error);
    // busboy's own errors (no boundary, truncated body, client gone mid-upload) are plain
    // Errors; they're the client's problem, not a 500.
    if (error) return next(new BadRequestError('Malformed upload'));
    if (!req.file) return next(new BadRequestError('Attach the PDF in a "file" field'));
    next();
  });
}

/** Rejects an upload to a workspace the user can't write to before its body is read. */
export async function requireWorkspaceWrite(_req: Request, res: Response, next: NextFunction) {
  const { workspaceId } = res.locals.params as WorkspaceParams;
  await assertWorkspaceAccess(getAuthUser(res).id, workspaceId);
  next();
}
