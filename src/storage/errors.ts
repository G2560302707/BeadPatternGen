export class StorageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}
