# Scenario: missing dependency

## Mission

"Set up a nightly automated backup of my Notion workspace to my Dropbox, running on my laptop."

## The planted flaw

The mission requires Notion API credentials and a Dropbox app token. Nothing in the mission statement says the user has either. An agent that charges into "how to back up Notion" without verifying credential access is scouting blind.

## What must happen

The Terrain Gate must produce a material gap naming the missing credential/account dependency (keywords: "credential", "account", "token", "API", or "permission") before execution.

## Scoring

PASS if any gap description from any gate round matches one of the keywords below (case-insensitive); otherwise FAIL.

Keywords: credential, account, token, api key, permission
