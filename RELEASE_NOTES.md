# Lumaire v1.0.8

Lyrics that keep up, cleaner artist searches, and update controls you can actually find. Available for Windows and Android.

## Keep the music and lyrics together

- Fixed lyrics quietly dropping out of sync while a song kept playing. Automatic scrolling now keeps following the song; you can still scroll yourself and tap “Back to sync” to return.
- Android saves your playback position when you close Lumaire from Recents, then reopens paused at that position. Closing the app stops playback; switching apps or locking the screen lets it continue.
- Tapping the Android media notification opens Lumaire again.

## Find the artist you meant

- Artist searches no longer fill up with collaboration entries. Matching profiles can combine when enough recordings confirm they belong to the same artist; uncertain namesakes stay separate.
- Either original artist link opens a confirmed combined profile. Favorites recognize both identities, and removing a favorite clears its matched aliases.
- Fixed spaces disappearing while you typed a search, including names such as Anirudh Ravichander.

## Less friction around your music

- Update downloads now have a large, highlighted button in a dedicated action area. It stays visible while you read the notes. This version's changes come first; earlier notes are collapsed.
- Clearer online playback setup, with visible download progress, cancellation and retry controls. Lumaire checks for stable yt-dlp engine updates automatically and keeps a fallback if an update fails.
- Improved interrupted download recovery and fixed a sync conflict affecting older saved favorites and playlists.

## Installing

**Windows:** download the update in Lumaire, then choose “Restart & Update” when you are ready. You can also run the Windows setup file attached to this release. Your library and settings stay in place.

**Android:** download the ARM64 APK attached to this release and open it to update Lumaire. Android asks you to confirm installation. Keep the existing app installed to preserve your data. Development builds with a different signing certificate cannot be updated with the public APK.

Online playback still depends on provider availability and your connection. Artist verification may leave duplicates separate when the evidence is incomplete. Windows installers do not have an Authenticode publisher certificate.
