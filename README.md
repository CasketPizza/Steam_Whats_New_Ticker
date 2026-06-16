# What's New RSS Ticker

![What's New RSS Ticker scrolling preview](assets/preview.gif)

A Millennium plugin that combines Steam Library's **What's New** articles with
RSS/Atom feeds and displays them as a continuous ticker or an automatically
advancing carousel.

## Requirements and Theme Compatibility

No Steam skin or Millennium theme is required. The plugin works with Steam's
default interface and can also run alongside compatible Millennium themes.

The plugin has been tested with:

- Steam's default interface
- [SpaceTheme for Steam](https://steambrew.app/theme/zQndv1rI0FXLh3QTRgOL)
- [Fluenty](https://steambrew.app/fluenty-steam)

Other Millennium themes may work, but have not been tested.

![What's New RSS Ticker](assets/splash.png)

## Features

- Offers continuous smooth scrolling or automatic page-by-page advancement.
- Page mode displays only complete cards that fit in the viewport, then advances
  to the next set after a configurable interval.
- Pauses while an article or Steam dialog is open.
- Resumes automatically when the dialog closes.
- Restores Steam's native previous/next pagination when an arrow is clicked.
- Resumes ticker mode after a configurable delay (10 seconds by default).
- Configurable speed from 10 to 200 pixels per second.
- Adds and removes RSS, Atom, YouTube playlist, and YouTube channel URLs from
  Millennium settings.
- Validates new feeds before saving them; failed feeds show an error below the
  URL field without leaving a broken entry in the feed list.
- Shows YouTube feed thumbnails and opens YouTube videos in the article popup
  when Steam's webview allows embedded playback.
- YouTube channel feeds can show all videos, normal videos, or Shorts, with
  controls for changing one saved feed or applying one mode to every saved
  YouTube channel feed.
- Displays RSS entries as What's New cards and opens them in a Library overlay.
- Provides configurable RSS publication date formatting, time format, weekday,
  and placement around each card.
- Adds a newspaper button beside the What's New settings cog for browsing all
  currently loaded Steam articles and every loaded RSS article in one
  scrollable grid.
- Adds `+` and `-` controls beside the newspaper button for creating and removing
  RSS rows without using Steam's Add Shelf menu.
- New RSS rows can combine every configured source or display one selected feed.
- Mixed RSS rows can include all sources, non-YouTube sources only, or YouTube
  sources only.
- Multiple mixed RSS rows divide the available article pool between them so the
  same article is not repeated across mixed rows.
- YouTube feeds can optionally be grouped under one combined source name.
- Matches RSS row card widths to the native What's New cards and omits redundant
  row headings.
- Provides an optional manual size override for RSS row article cards and opened
  RSS article popups.
- Displays Steam articles followed by newest RSS entries, or alternates a
  configurable number of RSS articles between Steam articles.
- Limits loaded RSS articles with a configurable maximum of 20 by default.
- Uses the single native carousel arrow pair to page the main What's New row and
  every configured RSS row together.
- Can keep RSS articles out of the main What's New row and show them only in
  separately configured RSS rows.
- Refreshes feeds when the Library is reopened, after an article closes, and at
  a configurable interval (60 minutes by default).
- Caches the last successful feed response so temporary network failures do not
  remove existing articles.
- Preserves article markup and skin styling; only ticker layout properties are
  applied.

## Usage

Enable **What's New RSS Ticker** in Millennium and restart Steam when prompted.
Then open Millennium settings and select **What's New RSS Ticker** to adjust
the ticker and RSS feed settings. In Library Home, use the `+` button beside
the newspaper button to add an RSS row. Rows can show mixed all-source articles,
mixed non-YouTube articles, mixed YouTube-only articles, or one configured feed.
Use the `-` button to choose any configured RSS row to remove. The main What's
New row is never included in the removal choices and always remains available.

RSS feeds are downloaded by the Millennium backend so feeds do not need to
permit browser cross-origin requests. Newly added feeds are checked before they
are saved; if a feed fails, the error is shown under the URL box and no broken
feed entry is added. Previously saved feeds that fail during a later refresh
remain listed, while any cached articles stay available.

YouTube playlist and channel URLs are converted to YouTube's Atom feed format
automatically. Channel URLs support direct `/channel/...` links, handles, custom
URLs, and user URLs. Channel feeds are newest-first and can be filtered to all
videos, normal videos, or Shorts per saved feed, or changed in bulk with the
YouTube channel selector above the feed list. Shorts detection depends
on markers exposed by YouTube's feed data, so entries without a Shorts marker
are treated as normal videos.

The legacy GameTrailers newest feed URL is redirected to the GameTrailers
YouTube feed. YouTube article links use an **Open in browser** button in the
popup.

## Source Layout

- `src/frontend/index.js` contains the readable frontend source.
- `.millennium/Dist/index.js` is the installed frontend entrypoint used by
  Millennium.
- `backend/main.lua` contains the backend feed fetcher.
