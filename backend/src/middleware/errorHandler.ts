import type { Request, Response, NextFunction  } from 'express';
import {HttpError} from '../utils/HttpError.js';

// body-parser (express.json) greške imaju type i status (npr. 413, 415)
type ErrorWithType = Error & { type?: string; status?: number };

export function errorHandler(err: ErrorWithType, req: Request, res: Response, _next: NextFunction) {

  if (err instanceof HttpError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
  }
  
  if(err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Neispravan JSON.' },
    });
  }

  // Telo veće od limita u express.json (100kb)
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Zahtev je prevelik.' },
    });
  }

  // Ostale body-parser greške klijenta (npr. nepodržan charset/encoding): ne smeju da budu 500
  if (err.type && err.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Neispravan zahtev.' },
    });
  }

  console.error(err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Greška na serveru.' },
  });
}
