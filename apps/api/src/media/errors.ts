/** A bad-image error from the media pipeline (unsupported format/oversize) → HTTP 400. */
export class MediaValidationError extends Error {
  constructor(message = 'unsupported or invalid image') {
    super(message);
    this.name = 'MediaValidationError';
  }
}
