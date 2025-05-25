# Comparing EventSub vs IRC WS trasports for chat

## Prerequisites

- A copy of this repository
- node.js (https://nvm.sh for easy non-system-global installation and management)
- A Twitch app and credentials for the app and user

## Creating a Twitch App / obtaining credentials

You'll need a Twitch app:

- Be in a browser window that is logged in to Twitch as _your_ (the "developer"'s)
  Twitch account
- Visit https://dev.twitch.tv/console/
- OAuth to the dev console if necessary
- Click "Register Your Application" at the top right
- Give it a unique name (e.g. "myusername chat testing")
- Give it a redirect URL of `http://localhost/`
  - Use `http` and not `https`; this is _only_ allowed for `localhost`
  - Be sure to include the trailing slash
- Pick whatever for "Category" (I used "Other")
- Select "Client Type" as "Confidential"
- Click "Create"
- From the applications list, click Manage
- Note down the Client ID
- Click "New Secret"
- Note down the Client Secret
  - Note: if you leave this page, you cannot get this value back, only
    generate a new one. Generating a new one is harmless but will cause
    any tokens generated with the old one to stop working.

You'll need a user access token with the appropriate scopes:

- Be in a browser window that is logged in to Twitch as the user you want to
  join the chats with the script
- Construct the initial OAuth URL:
  Replace `YOUR_CLIENT_ID_HERE` in the following URL:
  `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=YOUR_CLIENT_ID_HERE&redirect_uri=http://localhost/&scope=user%3Aread%3Achat+chat%3Aread+user%3Awrite%3Achat+chat%3Aedit`
- Visit that URL in the browser. You'll be redirected to an error page.
- Note down the value of the "code" in the query string of the URL

For the final step, we'll use `curl` in a shell - but you can use whatever
you want to make the request. The things we'll need are:

- Client ID
- Client Secret
- Code
- Unix Epoch timestamp of when we made the request (in milliseconds)
- From the response to the POST request:
  - "access_token"
  - "refresh_token"
  - "scope"
  - "expires_in"

I do it like this:

- Open two shells
- Open a Node repl in one, type `Date.now()`, leave it there
- In the other:
  - Note that the exports start with a space so they aren't saved to .bash_history
    - Note also that this only works if your .bashrc sets it up this way
  - ` export CLIENT_ID=<paste client id>`
  - ` export CLIENT_SECRET=<paste client secret>`
  - Make the auth request in the browser
  - ` export CODE=<paste code here>`
  - Click into the other shell and hit enter to "lock in" the timestamp
    - I do this _before_ running curl, so that the calculated expiry time
      of the token errs on the side of caution
  - Paste and execute: `curl -X POST 'https://id.twitch.tv/oauth2/token' -H 'Content-Type: application/x-www-form-urlencoded' -d "client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&code=$CODE&grant_type=authorization_code&redirect_uri=http://localhost/"`

## Configuring the app

Config is stored in two files, `config.json` and `secrets.json`. `config.json` is meant to be
edited by the user and is only read by the code. `secrets.json` is meant to be initially created
by the user but then never touched; it is both read from and written to by the code (e.g. when
refreshing an access token).

`secrets.json` is deliberately excluded from VSCode; you can remove the excludes in `.vscode/settings.json`
if you prefer.

Create `config.json` in the project root:

```jsonc
{
  "app": {
    // The script will request chat messages from the channels in the list given here
    "channels": ["username"],
    // the amount of time (in milliseconds) to wait for other messages to come in before
    // outputting
    "window": 1000,
  },
}
```

Create `secrets.json` in the project root:

```jsonc
{
  "app": {
    // The "Client ID" from your Twitch App's manage page
    "clientId": "",
    // The "Client Secret" from your Twitch App's manage page
    "clientSecret": "",
  },
  "user": {
    // The "access_token" from your POST request
    "accessToken": "",
    // The "refresh_token" from your POST request
    "refreshToken": "",
    // The "scopes" value (as a JSON array of strings) from your POST request
    "scope": [],
    // The timestamp of when you obtained the access token
    "obtainmentTimestamp": 0,
    // The "expires_in" value from your POST request
    "expiresIn": 0,
  },
}
```

## Running the code

`npm run compare`

You will see log messages like this:

```
[init] addUserForToken: 1156072662
chat connected
[eventsub:0] Connected socket for 1156072662
eventsub connected 1156072662
channels joined [ 'myndzi' ]
(2) [ircws, eventsub] <myndzi> hallo
```

You can redirect or tee the output as you like, or just leave it running
in screen/tmux/whatever.
