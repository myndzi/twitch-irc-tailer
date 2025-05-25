import tmi from 'tmi.js';
import { channels, intake } from './static_config';
import { WsClient } from './wsclient';

const client = new tmi.Client({
  channels,
  connection: {
    reconnect: true,
  },
});

type User = {
  id: string;
  login: string;
  displayName: string;
};

type Channel = {
  id: string;
  name: string;
};

const parseTimestamp = (v: string | undefined): number | undefined => {
  if (v === undefined) return;
  const num = Number(v);
  if (Number.isNaN(num) || !Number.isInteger(num) || num <= 0) return;
  return num;
};

type EventName = keyof tmi.Events & string;
type Types = {
  //// channel-related binds
  // usually present as a bind arg - the channel relevant to this event
  channel: string;

  //// events relating to other channels
  hoster: string;
  hostee: string;
  // hosted by / raided with N viewers
  viewers: number;
  // hosted via autohost
  autohost: boolean;

  //// user
  // usually present as a bind arg - the user of the person that generated the event
  username: string;
  // used in chat messages, and also messagedeleted - the contents of the message
  message: string;

  //// sub related stuff
  streakMonths: number;
  submethod: tmi.SubMethod;

  gifter: string;
  recipient: string;
  numberOfSubs: number;

  //// admin action stuff
  // username of the user that got banned / timed out / etc
  targetUsername: string;
  reason: string;
  duration: number;
  logins: string[]; // vip list, mod list

  // userstate variants - these define which tags we expect to exist
  chat: tmi.ChatUserstate;

  sub: tmi.SubUserstate;
  subgift: tmi.SubGiftUserstate;
  submysterygift: tmi.SubMysteryGiftUserstate;
  subgiftupgrade: tmi.SubGiftUpgradeUserstate;
  anongiftpaidupgrade: tmi.AnonSubGiftUpgradeUserstate;

  ban: tmi.BanUserstate;
  timeout: tmi.TimeoutUserstate;
  delete: tmi.DeleteUserstate; // message deleted

  room: tmi.RoomState;

  //// misc twitch stuff
  msgId: string;
  emoteSets: string;
  emoteObj: tmi.EmoteObj;
  // pong event
  latency: number;

  //// room state changes
  // how long a user must have been following for to chat
  length: number;
  // whether a mode was enabled or disabled
  enabled: boolean;

  //// connectivity
  // connect / connecting events
  address: string;
  port: number;
  // disconnection reason
  dcReason: string;
};

type RemoveIndex<T> = Exclude<
  {
    [K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]: T[K];
  },
  undefined
>;
type ObjectTypes = {
  [K in keyof Types as Extract<Types[K], { [key: string]: any }> extends never
    ? never
    : keyof RemoveIndex<Types[K]> extends never
      ? never
      : K]: RemoveIndex<Types[K]>;
};
type ObjectKeys = { [K in keyof ObjectTypes]: keyof ObjectTypes[K] }[keyof ObjectTypes];
type ObjectType<PK extends ObjectKeys> = {
  [K in keyof ObjectTypes]: PK extends keyof ObjectTypes[K] ? ObjectTypes[K][PK] : never;
}[keyof ObjectTypes];

export type TwitchEvent = {
  /**
   * The name of the tmi.js event handler that produced
   * this event
   */
  name: string;
  /**
   * The timestamp given by the irc tag, or else the
   * time this event was processed
   */
  ts: number;
  /**
   * The message id of a chat message
   */
  id?: string;
  /**
   * The channel that the event occurredin
   */
  channel?: Partial<Channel>;

  /**
   * The user the event is attributed to
   */
  user?: Partial<User>;
  /**
   * For non-anonymous gifts, whatever user data
   * we could aquire about the gifter. The message
   * is sent by the recipient, so that will be
   * the "user"
   */
  gifter?: Partial<User>;
  /**
   * For moderator actions, whatever user data
   * we could acquire about the target of the
   * action (e.g. ban, timeout...)
   */
  target?: Partial<User>;

  /**
   * Data that was bound from the event handler callback but not
   * handled explicitly
   */
  args?: { [key: string]: unknown };

  /**
   * Data that was present in IRC tags but not handled explicitly
   */
  tags?: { [key: string]: unknown };
};

type ChannelKey = {
  [K in keyof TwitchEvent]: Required<RemoveIndex<TwitchEvent[K]>> extends Channel ? K : never;
}[keyof TwitchEvent] &
  string;
const setChannelProp = <W extends ChannelKey, K extends keyof Channel>(
  obj: TwitchEvent,
  which: W,
  key: K,
  val: Channel[K] | undefined
) => {
  if (val === undefined) return;
  const u: Partial<Channel> = obj[which] ?? {};
  u[key] = val;
  obj[which] = u;
};

type UserKey = {
  [K in keyof TwitchEvent]: Required<RemoveIndex<TwitchEvent[K]>> extends User ? K : never;
}[keyof TwitchEvent] &
  string;
const setUserProp = <W extends UserKey, K extends keyof User>(
  obj: TwitchEvent,
  which: W,
  key: K,
  val: User[K] | undefined
) => {
  if (val === undefined) return;
  const u: Partial<User> = obj[which] ?? {};
  u[key] = val;
  obj[which] = u;
};

const setArgProp = (obj: TwitchEvent, key: string, val: unknown) => {
  if (val === undefined) return;
  obj.args ??= {};
  obj.args[key] = val;
};

const setTagProp = (obj: TwitchEvent, key: string, val: unknown) => {
  if (val === undefined) return;
  obj.tags ??= {};
  obj.tags[key] = val;
};

const setEventProp = <K extends keyof TwitchEvent>(obj: TwitchEvent, key: K, val: TwitchEvent[K] | undefined) => {
  if (val === undefined) return;
  obj[key] = val;
};

const ignoreTags = new Set<string>(['client-nonce']);

const assign = (name: string, keys: (string | null)[], vals: any[]) => {
  const evt: TwitchEvent = {
    name,
    ts: Date.now(),
  };

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    // ignore this arg
    if (key === null) continue;

    const val = vals[i];

    // bound arguments
    if ((val == null || typeof val !== 'object') && !Array.isArray(val)) {
      switch (key as keyof Types) {
        case 'msgId':
          setEventProp(evt, 'id', val);
          break;
        case 'username':
          // username as an argument to event handlers seems to be
          // _either_ the 'username' tag or the 'display-name' tag.
          // if a message contains 'display-name' but not 'username',
          // then the 'login' value will be incorrect, because the
          // value here will actually be the display-name and it
          // won't get overridden by the tag parsing later.
          // we don't really expect that to happen though.
          setUserProp(evt, 'user', 'login', val);
          break;
        case 'targetUsername':
          setUserProp(evt, 'target', 'login', val);
          break;
        case 'gifter':
          setUserProp(evt, 'gifter', 'login', val);
          break;
        case 'channel':
          setChannelProp(evt, 'channel', 'name', val);
          break;

        default:
          setArgProp(evt, key, val);
          break;
      }
      continue;
    }

    // we expect to probably only get one object type, which will often
    // be the state object that contains information we want to lift
    // to the top level -- but only if it exists.
    // check for a few things and assign them, removing them from
    // the data that will go on `evt` as we go

    for (const [ok, ov] of Object.entries(val)) {
      if (ignoreTags.has(ok)) continue;

      switch (ok as ObjectKeys) {
        case 'id':
          setEventProp(evt, 'id', ov as ObjectType<'id'>);
          break;
        case 'tmi-sent-ts': {
          setEventProp(evt, 'ts', parseTimestamp(ov as ObjectType<'tmi-sent-ts'>));
          break;
        }
        case 'room-id':
          setChannelProp(evt, 'channel', 'id', ov as ObjectType<'room-id'>);
          break;
        case 'username':
          setUserProp(evt, 'user', 'login', ov as ObjectType<'username'>);
          break;
        case 'user-id':
          setUserProp(evt, 'user', 'id', ov as ObjectType<'user-id'>);
          break;
        case 'display-name':
          setUserProp(evt, 'user', 'displayName', ov as ObjectType<'display-name'>);
          break;
        case 'target-user-id':
          setUserProp(evt, 'target', 'id', ov as ObjectType<'target-user-id'>);
          break;

        case 'msg-param-recipient-id':
          setUserProp(evt, 'target', 'id', ov as ObjectType<'msg-param-recipient-id'>);
          break;
        case 'msg-param-recipient-user-name':
          setUserProp(evt, 'target', 'login', ov as ObjectType<'msg-param-recipient-user-name'>);
          break;
        case 'msg-param-recipient-display-name':
          setUserProp(evt, 'target', 'displayName', ov as ObjectType<'msg-param-recipient-display-name'>);
          break;

        case 'msg-param-sender-login':
          setUserProp(evt, 'gifter', 'login', ov as ObjectType<'msg-param-sender-login'>);
          break;
        case 'msg-param-sender-name':
          setUserProp(evt, 'gifter', 'displayName', ov as ObjectType<'msg-param-sender-name'>);
          break;

        default:
          setTagProp(evt, ok, ov);
          break;
      }
    }

    continue;
  }

  return evt;
};

type EventKey = keyof Types | null;

type Remap<T extends [...any[]]> = { [K in keyof T]: EventKey | { hint: T[K] } };
type RemapParams<EN extends EventName> = Remap<Parameters<tmi.Events[EN]>>;

const enabled = new Set<EventName>([
  'anongiftpaidupgrade',
  'ban',
  'cheer',
  'clearchat',
  'connected', // client connected to the server
  // 'connecting', // client began connecting to the server
  'disconnected', // client was disconnected from the server
  'emoteonly',
  // 'emotesets', // tmi.js source code says it's unused
  'followersonly',
  'giftpaidupgrade',
  'hosted',
  'hosting',
  // 'join', // useless - tmi.js doesn't send us our own join message!
  // 'logon', // produced by tmi.js before it attempts to authenticate
  'message',
  'messagedeleted',
  'mod',
  // 'mods', // list of mods (in response to a /mods request - deprecated)
  'notice', // server-sent notices, not irc protocol NOTICE in its usual form
  // 'part', // useless - tmi.js doesn't send us our own part message!
  // 'ping', // don't need pings
  'pong', // might be useful to collect latency data
  'r9kbeta',
  'raided',
  // 'reconnect', // client began reconnection
  'resub',
  // 'roomstate', // upon joining a room, server sends us the room's settings
  // 'serverchange', // twitch wants us to reconnect
  'slowmode',
  'subgift',
  'submysterygift',
  'subscribers',
  'subscription',
  'timeout',
  'unhost',
  'unmod',
  // 'vips', // list of vips (in response to a /vips request - deprecated)
]);

const assertCaptures = (vs: (EventKey | { hint: any })[]): vs is EventKey[] =>
  vs.every(v => v === null || typeof v === 'string');

const wsClient = new WsClient(intake);
const bind = <EN extends EventName, Ks extends RemapParams<EN>>(event: EN, ...captures: Ks) => {
  if (!enabled.has(event)) return;

  if (!assertCaptures(captures)) {
    throw new Error(
      `Use only strings or null for bind params. The '{hint: <type>}' is to help you know what you're assigning...`
    );
  }

  client.on(event, (...args: any[]) => {
    const msg = assign(event, captures, args);

    const { ts, name, tags, user, channel, gifter, target } = msg;
    console.log(`${new Date(ts).toISOString()} [${name}]`, { user, channel, gifter, target });
    wsClient.push(msg);
  });
};

// covered my the "message" event
// bind('action', 'channel', 'chat', 'message', null); // Received action message on channel.
bind('anongiftpaidupgrade', 'channel', 'username', 'anongiftpaidupgrade'); // Username is continuing the Gift Sub they got from an anonymous user in channel.
bind('ban', 'channel', 'targetUsername', 'reason', 'ban'); // Username has been banned on a channel.
// covered by the "message" event
// bind('chat', 'channel', 'chat', 'message', null); // Received message on channel.
// even though "cheer" has the same data contents as "message",
// it doesn't emit "message" so we have to bind it separately
bind('cheer', 'channel', 'chat', 'message'); // Username has cheered to a channel.
bind('clearchat', 'channel'); // Chat of a channel got cleared.
bind('connected', 'address', 'port'); // Connected to server.
bind('connecting', 'address', 'port'); // Connecting to a server.
bind('disconnected', 'dcReason'); // Got disconnected from server.
bind('emoteonly', 'channel', 'enabled'); // Channel enabled or disabled emote-only mode.
bind('emotesets', 'emoteSets', 'emoteObj'); // Received the emote-sets from Twitch.
bind('followersonly', 'channel', 'enabled', 'length'); // Channel enabled or disabled followers-only mode.
bind('giftpaidupgrade', 'channel', 'username', 'gifter', 'subgiftupgrade'); // Username is continuing the Gift Sub they got from sender in channel.
bind('hosted', 'channel', 'hoster', 'viewers', 'autohost'); // Channel is now hosted by another broadcaster.
bind('hosting', 'channel', 'hostee', 'viewers'); // Channel is now hosting another channel.
bind('join', 'channel', 'username', null); // Username has joined a channel.
bind('logon'); // Connection established, sending informations to server.
bind('message', 'channel', 'chat', 'message', null); // Received a message.
bind('messagedeleted', 'channel', 'targetUsername', 'message', 'delete'); // Message was deleted/removed.
bind('mod', 'channel', 'targetUsername'); // Someone got modded on a channel.
bind('mods', 'channel', 'logins'); // Received the list of moderators of a channel.
bind('notice', 'channel', 'msgId', 'message'); // Received a notice from server.
bind('part', 'channel', 'username', null); // User has left a channel.
bind('ping'); // Received PING from server.
bind('pong', 'latency'); // Sent a PING request ? PONG.
bind('r9kbeta', 'channel', 'enabled'); // Channel enabled or disabled R9K mode.
bind('raided', 'channel', 'username', 'viewers'); // Channel is now being raided by another broadcaster.
// bind('raw_message', null, null); // IRC data was received and parsed.
bind('reconnect'); // Trying to reconnect to server.
bind('resub', 'channel', 'username', 'streakMonths', 'message', 'sub', 'submethod'); // Username has resubbed on a channel.
bind('roomstate', 'channel', 'room'); // The current state of the channel.
bind('serverchange', 'channel'); // Channel is no longer located on this cluster.
bind('slowmode', 'channel', 'enabled', 'length'); // Gives you the current state of the channel.
bind('subgift', 'channel', 'username', 'streakMonths', 'recipient', 'submethod', 'subgift'); // Username gifted a subscription to recipient in a channel.
bind('submysterygift', 'channel', 'username', 'numberOfSubs', 'submethod', 'submysterygift'); // Username is gifting a subscription to someone in a channel.
bind('subscribers', 'channel', 'enabled'); // Channel enabled or disabled subscribers-only mode.
bind('subscription', 'channel', 'username', 'submethod', 'message', 'sub'); // Username has subscribed to a channel.
bind('timeout', 'channel', 'targetUsername', 'reason', 'duration', 'timeout'); // Username has been timed out on a channel.
bind('unhost', 'channel', 'viewers'); // Channel ended the current hosting.
bind('unmod', 'channel', 'targetUsername'); // Someone got unmodded on a channel.
bind('vips', 'channel', 'logins'); // Received the list of VIPs of a channel.
// covered by the "message" event

client.connect();
