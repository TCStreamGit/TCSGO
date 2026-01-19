# TCSGO Sound Assets

This folder should contain the following sound files for the case opening animation:

## Required Files

| File | Description | Recommended Duration |
|------|-------------|---------------------|
| `tick.mp3` | Short tick sound when reel cards pass the marker | ~50-100ms |
| `reveal.mp3` | Sound when final item is revealed (standard items) | ~1-2s |
| `rare.mp3` | Special sound for pink/red tier items | ~2-3s |
| `gold-reveal.mp3` | Epic sound for gold tier (knives/gloves) | ~3-5s |

## Sourcing Sounds

You can extract these sounds from:
1. CS:GO/CS2 game files (search for case opening sounds)
2. Free sound effect libraries (freesound.org, mixkit.co)
3. Create custom sounds

## File Format

- Format: MP3
- Sample Rate: 44100 Hz
- Bitrate: 128-192 kbps
- Channels: Stereo or Mono

## Notes

- Keep file sizes small for fast loading
- The tick sound will play rapidly during the spin, so it should be very short
- Test sounds at various volumes as stream audio levels vary
