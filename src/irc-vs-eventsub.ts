import { loadConfig } from './config/config';
import { resolve } from 'node:path';
import { initTwurple } from './twurple';
import { OrderedMap } from './orderedmap';

type ChannelId = string & { __brand__: 'channelid' };

// https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=lue6oxmyc1kfhbwuzuphh8mzr4ndpf&redirect_uri=http://localhost/&scope=user%3Aread%3Achat+chat%3Aread+user%3Awrite%3Achat+chat%3Aedit
// curl -X POST 'https://id.twitch.tv/oauth2/token' -H 'Content-Type: application/x-www-form-urlencoded' -d "client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&code=$CODE&grant_type=authorization_code&redirect_uri=http://localhost/"

(async () => {
  const { config, secrets, updateTwitchUserToken } = await loadConfig({
    configDir: resolve(__dirname, '..'),
  });

  const {
    apiClient,
    chatClient,
    tokenUserId,
    createEventSubWsListener,
    shutdown: shutdownTwurple,
  } = await initTwurple({ secrets, updateTwitchUserToken });

  const self = await apiClient.users.getUserById(tokenUserId);
  if (!self || !self.id || !self.name) {
    throw new Error('Failed to resolve auth user identity');
  }

  const me: User = {
    id: self.id,
    login: self.name,
    displayName: self.displayName,
  };
  console.log('me', me);

  const channels = new Map<ChannelId, string>();

  for (const channel of await apiClient.users.getUsersByNames(config.app.channels)) {
    channels.set(channel.id as ChannelId, channel.name);
  }

  const combine = (a: UnifiedChatMessage, b: UnifiedChatMessage): UnifiedChatMessage => ({
    ...a,
    ...b,
    localTimestamp: Math.max(a.localTimestamp, b.localTimestamp),
    sources: a.sources.concat(b.sources),
  });

  const events = new OrderedMap(combine, 'msgId', 'localTimestamp');

  const WINDOW_SIZE = 1_000;

  setInterval(() => {
    const cutoff = Date.now() - WINDOW_SIZE;

    events.process(item => {
      if (item.localTimestamp > cutoff) return item;

      const count = item.sources.length;

      console.log(`(${count}) [${item.sources.join(', ')}] #${item.channel.login} <${item.user.login}> ${item.text}`);
    });
  }, WINDOW_SIZE).unref();

  type User = {
    id: string;
    login: string;
    displayName?: string;
  };

  type UnifiedChatMessage = {
    sources: ('eventsub' | 'ircws')[];
    user: User;
    channel: User;
    msgId: string; // uuid
    tmiTimestamp?: string;
    localTimestamp: number;
    text: string;
  };

  chatClient.onConnect(() => {
    console.log('chat connected');

    const channelNames = [...channels.values()];
    Promise.all(channelNames.map(channel => chatClient.join(channel)))
      .then(() => {
        console.log('channels joined', channelNames);
      })
      .catch(err => {
        console.error('failed to join channels', err);
      });
  });
  chatClient.onDisconnect(() => {
    console.log('chat disconnected');
  });

  type Ok<T> = { ok: true; val: T };
  type Err<T> = { ok: false; val: T };
  type Maybe<T> = { ok: boolean; val: T };

  const extractTags = <K extends string>(map: Map<string, string>, tags: K[]): Maybe<Record<K, string>> => {
    const obj: Maybe<Record<K, string>> = { ok: true, val: {} as any };

    for (const tag of tags) {
      const val = map.get(tag);
      if (val === undefined) {
        obj.ok = false;
      } else {
        obj.val[tag] = val;
      }
    }

    return obj;
  };
  chatClient.onMessage((channel, user, text, msg) => {
    const { ok, val: tags } = extractTags(msg.tags, ['user-id', 'display-name', 'room-id', 'id', 'tmi-sent-ts']);

    if (!ok) {
      console.error('missing expected tags', { channel, user, text, tags });
      return;
    }

    const ucm: UnifiedChatMessage = {
      sources: ['ircws'],
      user: {
        id: tags['user-id'],
        login: user,
        displayName: tags['display-name'],
      },
      channel: {
        id: tags['room-id'],
        login: channel,
      },
      msgId: tags['id'],
      tmiTimestamp: tags['tmi-sent-ts'],
      localTimestamp: Date.now(),
      text,
    };

    events.add(ucm);
  });

  chatClient.connect();

  const eventSub = createEventSubWsListener();
  eventSub.onUserSocketConnect(userId => {
    console.log('eventsub connected', userId);
  });
  eventSub.onUserSocketDisconnect((userId, error) => {
    console.error('eventsub disconnected', userId, error);
  });

  for (const id of channels.keys()) {
    eventSub.onChannelChatMessage(id, me.id, msg => {
      const ucm: UnifiedChatMessage = {
        sources: ['eventsub'],
        user: {
          id: msg.chatterId,
          login: msg.chatterName,
          displayName: msg.chatterDisplayName,
        },
        channel: {
          id: msg.broadcasterId,
          login: msg.broadcasterName,
          displayName: msg.broadcasterDisplayName,
        },
        msgId: msg.messageId,
        text: msg.messageText,
        localTimestamp: Date.now(),
      };

      events.add(ucm);
    });
  }

  eventSub.start();
})();
