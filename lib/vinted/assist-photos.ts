import {
  hasSavedPhoto,
  materializeSavedPhotos,
  type ReadyPhotoBytes,
  type SavedPhotoRef,
} from "@/lib/vinted/saved-photo";

/**
 * The ready snapshot may have text for an SKU while its `photos` array is empty
 * (or only has unusable stubs). The Vinted queue still shows thumbs from jobs via
 * previewUrl. Prefer snapshot bytes when present; otherwise use the job/archive
 * photos for that SKU.
 */
export function selectAssistPhotoRefs(
  snapshotPhotos: readonly SavedPhotoRef[],
  fallbackPhotos: readonly SavedPhotoRef[]
): SavedPhotoRef[] {
  const fromSnapshot = snapshotPhotos.filter((photo) => hasSavedPhoto(photo));
  if (fromSnapshot.length > 0) return fromSnapshot;
  return fallbackPhotos.filter((photo) => hasSavedPhoto(photo));
}

export async function materializeAssistPhotos(
  snapshotPhotos: readonly SavedPhotoRef[],
  fallbackPhotos: readonly SavedPhotoRef[],
  download: (url: string) => Promise<ReadyPhotoBytes | null>
): Promise<ReadyPhotoBytes[]> {
  return materializeSavedPhotos(selectAssistPhotoRefs(snapshotPhotos, fallbackPhotos), download);
}
