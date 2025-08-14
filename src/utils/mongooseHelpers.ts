import { Document } from 'mongoose';

/**
 * Converts a Mongoose document to a plain object with proper typing
 */
export function toPlainObject<T>(doc: Document & any): T {
  return doc.toObject() as T;
}

/**
 * Safely casts a Mongoose document to the expected interface type
 */
export function castDocument<T>(doc: any): T {
  if (!doc) return doc;
  
  // If it's already a plain object, return as is
  if (!doc.toObject) return doc as T;
  
  // Convert to plain object and cast
  return doc.toObject() as T;
}

/**
 * Safely casts an array of Mongoose documents to the expected interface type
 */
export function castDocuments<T>(docs: any[]): T[] {
  return docs.map(doc => castDocument<T>(doc));
}