import type { Node } from '../../types';
import { generateNodeId } from '../tree-sitter-helpers';

export function generateUnityNodeId(
  assetGuid: string,
  kind: Node['kind'],
  localFileId: string
): string {
  return generateNodeId(`unity-guid:${assetGuid}`, kind, localFileId, 1);
}
