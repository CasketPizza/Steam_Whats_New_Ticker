# What's New RSS Ticker

![What's New RSS Ticker scrolling preview](assets/preview.gif)

A Millennium plugin that combines Steam Library's **What's New** articles with
RSS/Atom feeds and displays them as a continuous ticker or an automatically
advancing carousel.

## Requirements and Theme Compatibility

> [!IMPORTANT]
> An applied Millennium theme is required. This plugin does not work with
> Steam's unthemed default interface.

The plugin has been tested with:

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
- Adds and removes RSS or Atom feed URLs from Millennium settings.
- Displays RSS entries as What's New cards and opens them in a Library overlay.
- Provides configurable RSS publication date formatting, time format, weekday,
  and placement around each card.
- Adds a newspaper button beside the What's New settings cog for browsing all
  currently loaded Steam and RSS articles in one scrollable grid.
- Adds `+` and `-` controls beside the newspaper button for creating and removing
  RSS rows without using Steam's Add Shelf menu.
- New RSS rows can combine every configured source or display one selected feed.
- Multiple mixed RSS rows divide the available article pool between them so the
  same article is not repeated across mixed rows.
- Matches RSS row card widths to the native What's New cards and omits redundant
  row headings.
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

Install and apply a compatible Millennium theme, enable
**What's New RSS Ticker**, and restart Steam when prompted. Then open
Millennium settings and select **What's New RSS Ticker** to adjust the ticker
and RSS feed settings. In Library Home, use the `+` button beside the newspaper
button to add an RSS row, choose mixed sources or one configured feed, and use
the `-` button to choose any configured RSS row to remove. The main What's New
row is never included in the removal choices and always remains available.

RSS feeds are downloaded by the Millennium backend so feeds do not need to
permit browser cross-origin requests. A feed that fails remains listed with an
error, while any previously cached articles stay available.
