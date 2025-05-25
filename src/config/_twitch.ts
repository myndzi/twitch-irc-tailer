import { StaticDecode, Type as T } from '@sinclair/typebox';

import { TSecret } from './secret';

export const AppCredentials = T.Object({
  clientId: T.String(),
  clientSecret: TSecret('clientSecret', T.String()),
});
export type AppCredentials = StaticDecode<typeof AppCredentials>;

export const UserCredentials = T.Object({
  accessToken: TSecret('accessToken', T.String()),
  refreshToken: TSecret('refreshToken', T.Union([T.Null(), T.String()])),
  scope: T.Array(T.String()),
  obtainmentTimestamp: T.Number(),
  expiresIn: T.Union([T.Null(), T.Number()]),
});
export type UserCredentials = StaticDecode<typeof UserCredentials>;

export const TwitchSecrets = T.Object({
  app: AppCredentials,
  user: UserCredentials,
});
export type TwitchSecrets = StaticDecode<typeof TwitchSecrets>;
