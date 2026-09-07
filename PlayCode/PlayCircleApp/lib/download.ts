import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Cross-platform "save this blob somewhere the user can get to it". On web
// that's a real browser download; on native there's no filesystem the user
// browses directly, so we write to the cache dir and hand it to the OS
// share sheet (save to Files, share via another app, etc).
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  const buffer = await blob.arrayBuffer();
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(new Uint8Array(buffer));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri);
  }
}
