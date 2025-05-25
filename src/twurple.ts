import { AuthProvider, RefreshingAuthProvider } from '@twurple/auth';
import { ChatClient } from '@twurple/chat';
import { ApiClient, UserIdResolvable } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';

import { RootConfig } from './config/config';

export type TwurpleConfig = {
  clientId: string;
  clientSecret: string;
};

export interface TwurpleClients {
  tokenUserId: string;
  apiClient: ApiClient;
  chatClient: ChatClient;
  createEventSubWsListener: () => EventSubWsListener;
  shutdown: () => void;
}

let clients: null | TwurpleClients = null;

export const initTwurple = async ({
  secrets,
  updateTwitchUserToken,
}: Pick<RootConfig, 'secrets' | 'updateTwitchUserToken'>): Promise<TwurpleClients> => {
  if (clients) return clients;

  const { app: appCreds, user: userCreds } = secrets.twitch;

  const authProvider = new RefreshingAuthProvider({
    clientId: appCreds.clientId,
    clientSecret: appCreds.clientSecret.unwrap(),
  });

  const tokenUserId = await authProvider.addUserForToken(
    {
      accessToken: userCreds.accessToken.unwrap(),
      refreshToken: userCreds.refreshToken.unwrap(),
      scope: userCreds.scope,
      obtainmentTimestamp: userCreds.obtainmentTimestamp,
      expiresIn: userCreds.expiresIn,
    },
    ['chat']
  );
  console.log(`[init] addUserForToken: ${tokenUserId}`);

  authProvider.onRefresh(async (userId, token) => {
    try {
      await updateTwitchUserToken({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        scope: token.scope,
        obtainmentTimestamp: token.obtainmentTimestamp,
        expiresIn: token.expiresIn,
      });
      console.log(`[authProvider]: saved user credentials for userid=${userId}`);
    } catch (e) {
      console.log(
        `[authProvider]: failed to save user credentials for userid=${userId}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  });

  authProvider.onRefreshFailure(reason => {
    console.log(`[authProvider]: failed to refresh token: ${reason}`);
  });

  const apiClient = new ApiClient({ authProvider });
  const chatClient = new ChatClient({ authProvider });

  const wsListeners = [] as EventSubWsListener[];
  let listenerId = 0;

  const createEventSubWsListener = () => {
    const id = listenerId++;

    // dunno if this is still necessary....
    const eventSubAuthProvider: AuthProvider = {
      clientId: appCreds.clientId,
      getCurrentScopesForUser: (user: UserIdResolvable) => authProvider.getCurrentScopesForUser(user),
      getAccessTokenForUser: (_: UserIdResolvable, ...scopeSets: Array<string[] | undefined>) =>
        authProvider.getAccessTokenForUser(tokenUserId, ...scopeSets),
      getAnyAccessToken: (user?: UserIdResolvable) => authProvider.getAnyAccessToken(user),
    };
    const listener = new EventSubWsListener({
      apiClient: new ApiClient({
        authProvider: eventSubAuthProvider,
      }),
    });

    listener.onUserSocketConnect(userId => {
      console.log(`[eventsub:${id}] Connected socket for ${userId}`);
    });
    listener.onUserSocketDisconnect(userId => {
      console.log(`[eventsub:${id}] Disconnected socket for ${userId}`);
    });

    listener.onRevoke(event => {
      console.log(`[eventsub:${id}] Subscription revoked: ${event}`);
    });

    wsListeners.push(listener);
    return listener;
  };

  clients = {
    tokenUserId,
    apiClient,
    chatClient,
    createEventSubWsListener,
    shutdown: () => {
      console.log('twurple shutdown');
      chatClient.quit();
      for (const listener of wsListeners) {
        listener.stop();
      }
    },
  };

  return clients;
};
