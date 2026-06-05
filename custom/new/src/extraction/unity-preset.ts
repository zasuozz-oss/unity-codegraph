/**
 * Unity preset — the single source of truth for how `codegraph unity …` treats a
 * Unity project. As of the "C#-only" change it mirrors antigravity-gitnexus exactly:
 * Unity assets are treated as NOISE and never parsed; the index is pure game C#.
 *
 * Two gates, both active only in Unity mode (see `unity-mode.ts`):
 *   - `grammars.ts` → `UNITY_ASSET_EXTENSIONS` are SKIPPED (never extracted).
 *   - `index.ts`    → `UNITY_ALL_IGNORE_DIRS` are not walked (engine + SDK + asset
 *                     folders + Plugins/Packages/Editor/third-party).
 *
 * Net effect: a Unity project indexes the same C# scripts gitnexus does — no
 * `.prefab/.unity/.asset/.meta` asset nodes, no prefab→script GUID links, and no
 * third-party SDK / plugin code.
 */
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// SKIPPED — Unity asset files (never parsed; treated as noise, like gitnexus)
// ============================================================================

/**
 * Unity asset/serialized extensions CodeGraph SKIPS in Unity mode. The grammar
 * gate short-circuits on these before EXTENSION_MAP, so they never become nodes —
 * matching gitnexus, which wants only the C# graph. (Previously CodeGraph parsed
 * these for prefab→script GUID links; that is intentionally dropped here.)
 */
export const UNITY_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  '.prefab', '.unity', '.asset', '.meta', '.asmdef',
]);

/** Asset extensions that produce graph nodes in full-asset mode.
 * `.meta` is a GUID sidecar and `.asmdef` has its own extractor. */
export const UNITY_ASSET_NODE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.prefab', '.unity', '.asset',
]);

// ============================================================================
// SKIPPED — directories never walked in Unity mode
// ============================================================================

/** Unity engine-managed / generated dirs that never contain game code. */
export const UNITY_ENGINE_IGNORE_DIRS: readonly string[] = [
  'Library', 'Temp', 'Logs', 'MemoryCaptures', 'Recordings',
  'UserSettings', 'ProjectSettings', 'Packages', 'Build', 'Builds',
  // C#/IDE build output that Unity regenerates
  'obj',
  // Editor-only scripts (any depth under Assets/) — gitnexus parity
  'Editor', 'Editor Default Resources',
  // Agent tooling — not game code
  '.claude',
];

/**
 * Third-party SDK / plugin folders found under `Assets/` — large, vendored, not
 * first-party game code. Ported verbatim from antigravity-gitnexus' KNOWN_UNITY_SDKS.
 * Mapped name → human label (label is informational).
 */
export const UNITY_SDK_DIRS: Readonly<Record<string, string>> = {
  Adjust: 'Adjust SDK',
  AppsFlyer: 'AppsFlyer SDK',
  AVProVideo: 'AVPro Video SDK',
  'CMP Admob': 'CMP Admob',
  Extension: 'Extension Scripts',
  ExternalDependencyManager: 'Google EDM',
  FacebookSDK: 'Facebook SDK',
  Feel: 'MoreMountains Feel',
  DOTween: 'DOTween Animation Engine',
  Demigiant: 'DOTween/Demigiant Assets',
  Firebase: 'Firebase SDK',
  GoogleMobileAds: 'Google Ads SDK',
  GooglePlayGames: 'Google Play Games',
  IronSource: 'IronSource SDK',
  IronSourceAdQuality: 'IronSource Ad Quality',
  LevelPlay: 'LevelPlay SDK',
  NuGet: 'NuGet packages',
  'TextMesh Pro': 'TextMesh Pro',
  Plugins: 'Native plugins',
  PlayerPrefsEditor: 'PlayerPrefs Editor',
  'Mirza Beig': 'Mirza Beig assets',
  WebGLTemplates: 'WebGL Templates',
  WebPlayerTemplates: 'Web Player Templates',
  Vuforia: 'Vuforia SDK',
  Photon: 'Photon SDK',
  PlayFab: 'PlayFab SDK',
  Chartboost: 'Chartboost SDK',
  AdMob: 'AdMob SDK',
  UnityPurchasing: 'Unity IAP',
  Oculus: 'Oculus SDK',
  SteamVR: 'SteamVR SDK',
  Spine: 'Spine 2D Animation SDK',
  MaxSdk: 'AppLovin MAX SDK',
  AppLovinSdk: 'AppLovin SDK',
};

/**
 * Folder names that conventionally hold only assets (no game code). Ported from
 * gitnexus' UNITY_ASSET_ONLY_PATTERNS. Matched as a directory name at any depth.
 */
export const UNITY_ASSET_ONLY_DIRS: readonly string[] = [
  'Animation', 'Animations', 'Font', 'Fonts',
  'Matterial', 'Materials', 'Particle', 'Particles',
  'Prefabs', 'Resources', 'Scenes', 'Sound', 'Sounds',
  'Sprite', 'Sprites', 'Sprite Atlas',
  'StreamingAssets', 'AddressableAssetsData', 'Localization',
  'GeneratedLocalRepo', 'MoreGame', 'Textures', 'Models',
];

/** Every directory name skipped in Unity mode (engine + vendored SDKs + asset-only). */
export const UNITY_ALL_IGNORE_DIRS: readonly string[] = [
  ...UNITY_ENGINE_IGNORE_DIRS,
  ...Object.keys(UNITY_SDK_DIRS),
  ...UNITY_ASSET_ONLY_DIRS,
];

/** Directories ignored in full-asset mode: engine/generated + SDKs, but not asset dirs. */
export const UNITY_ASSET_MODE_IGNORE_DIRS: readonly string[] = [
  ...UNITY_ENGINE_IGNORE_DIRS.filter((d) => d !== 'ProjectSettings'),
  ...Object.keys(UNITY_SDK_DIRS),
];

// ============================================================================
// SKIPPED — Unity non-code asset extensions (documentation / explicit intent)
// ============================================================================

/**
 * Unity binary/asset extensions CodeGraph does NOT parse. These are skipped
 * naturally because they are absent from `EXTENSION_MAP`; the set is kept here so
 * the skip intent is explicit and greppable.
 */
export const UNITY_SKIP_EXTENSIONS: ReadonlySet<string> = new Set([
  '.mat', '.controller', '.overrideController', '.mask', '.anim',
  '.physicMaterial', '.physicsMaterial2D', '.spriteatlas', '.spriteatlasv2',
  '.renderTexture', '.lighting', '.shadergraph', '.shader', '.cginc',
  '.compute', '.hlsl', '.cubemap', '.flare', '.giparams', '.guiskin',
  '.fontsettings', '.brush', '.mixer', '.preset', '.signal', '.terrainlayer',
  // media / binary
  '.png', '.jpg', '.jpeg', '.tga', '.psd', '.fbx', '.obj', '.wav', '.mp3',
  '.ogg', '.ttf', '.otf',
]);

// ============================================================================
// DETECTION
// ============================================================================

/** A Unity project root has both `Assets/` and `ProjectSettings/` directories. */
export function isUnityProject(repoPath: string): boolean {
  try {
    return (
      fs.statSync(path.join(repoPath, 'Assets')).isDirectory() &&
      fs.statSync(path.join(repoPath, 'ProjectSettings')).isDirectory()
    );
  } catch {
    return false;
  }
}
