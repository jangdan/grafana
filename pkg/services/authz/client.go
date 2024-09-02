package authz

import (
	"context"

	"github.com/fullstorydev/grpchan"
	"github.com/fullstorydev/grpchan/inprocgrpc"
	authnlib "github.com/grafana/authlib/authn"
	authzlib "github.com/grafana/authlib/authz"
	authzv1 "github.com/grafana/authlib/authz/proto/v1"
	"github.com/grafana/authlib/claims"
	grpcAuth "github.com/grpc-ecosystem/go-grpc-middleware/v2/interceptors/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/grafana/grafana/pkg/apimachinery/identity"
	"github.com/grafana/grafana/pkg/infra/tracing"
	"github.com/grafana/grafana/pkg/services/accesscontrol"
	"github.com/grafana/grafana/pkg/services/featuremgmt"
	"github.com/grafana/grafana/pkg/services/grpcserver"
	"github.com/grafana/grafana/pkg/setting"
)

// `authzService` is hardcoded in authz-service
const authzServiceAudience = "authzService"

type Client interface {
	authzlib.MultiTenantClient
}

// ProvideAuthZClient provides an AuthZ client and creates the AuthZ service.
func ProvideAuthZClient(
	cfg *setting.Cfg, features featuremgmt.FeatureToggles, acSvc accesscontrol.Service,
	grpcServer grpcserver.Provider, tracer tracing.Tracer,
) (Client, error) {
	if !features.IsEnabledGlobally(featuremgmt.FlagAuthZGRPCServer) {
		return nil, nil
	}

	authCfg, err := ReadCfg(cfg)
	if err != nil {
		return nil, err
	}

	var client authzlib.MultiTenantClient

	// Register the server
	server, err := newLegacyServer(acSvc, features, grpcServer, tracer, authCfg)
	if err != nil {
		return nil, err
	}

	switch authCfg.mode {
	case ModeInProc:
		client, err = newInProcLegacyClient(server)
		if err != nil {
			return nil, err
		}
	case ModeGRPC:
		client, err = newGrpcLegacyClient(authCfg)
		if err != nil {
			return nil, err
		}
	case ModeCloud:
		client, err = newCloudLegacyClient(authCfg)
		if err != nil {
			return nil, err
		}
	}

	return client, err
}

// ProvideStandaloneAuthZClient provides a standalone AuthZ client, without registering the AuthZ service.
// You need to provide a remote address in the configuration
func ProvideStandaloneAuthZClient(
	cfg *setting.Cfg, features featuremgmt.FeatureToggles, tracer tracing.Tracer,
) (Client, error) {
	if !features.IsEnabledGlobally(featuremgmt.FlagAuthZGRPCServer) {
		return nil, nil
	}

	authCfg, err := ReadCfg(cfg)
	if err != nil {
		return nil, err
	}

	return newGrpcLegacyClient(authCfg)
}

func newInProcLegacyClient(server *legacyServer) (authzlib.MultiTenantClient, error) {
	noAuth := func(ctx context.Context) (context.Context, error) {
		return ctx, nil
	}

	channel := &inprocgrpc.Channel{}
	channel.RegisterService(
		grpchan.InterceptServer(
			&authzv1.AuthzService_ServiceDesc,
			grpcAuth.UnaryServerInterceptor(noAuth),
			grpcAuth.StreamServerInterceptor(noAuth),
		),
		server,
	)

	return authzlib.NewLegacyClient(
		&authzlib.MultiTenantClientConfig{},
		authzlib.WithGrpcConnectionLCOption(channel),
		// nolint:staticcheck
		authzlib.WithNamespaceFormatterLCOption(claims.OrgNamespaceFormatter),
		authzlib.WithDisableAccessTokenLCOption(),
	)
}

func newGrpcLegacyClient(authCfg *Cfg) (authzlib.MultiTenantClient, error) {
	// This client interceptor is a noop, as we don't send an access token
	grpcClientConfig := authnlib.GrpcClientConfig{}
	clientInterceptor, err := authnlib.NewGrpcClientInterceptor(&grpcClientConfig,
		authnlib.WithDisableAccessTokenOption(),
		authnlib.WithIDTokenExtractorOption(func(ctx context.Context) (string, error) {
			r, err := identity.GetRequester(ctx)
			if err != nil {
				return "", err
			}
			token := r.GetIDToken()
			return token, nil
		}),
	)
	if err != nil {
		return nil, err
	}

	cfg := authzlib.MultiTenantClientConfig{RemoteAddress: authCfg.remoteAddress}
	client, err := authzlib.NewLegacyClient(&cfg,
		authzlib.WithGrpcDialOptionsLCOption(
			getDialOpts(clientInterceptor, authCfg.allowInsecure)...,
		),
		// nolint:staticcheck
		authzlib.WithNamespaceFormatterLCOption(claims.OrgNamespaceFormatter),
		// TODO: remove this once access tokens are supported on-prem
		authzlib.WithDisableAccessTokenLCOption(),
	)
	if err != nil {
		return nil, err
	}

	return client, nil
}

func newCloudLegacyClient(authCfg *Cfg) (authzlib.MultiTenantClient, error) {
	grpcClientConfig := authnlib.GrpcClientConfig{
		TokenClientConfig: &authnlib.TokenExchangeConfig{
			Token:            authCfg.token,
			TokenExchangeURL: authCfg.tokenExchangeURL,
		},
		TokenRequest: &authnlib.TokenExchangeRequest{
			Namespace: authCfg.tokenNamespace,
			Audiences: []string{authzServiceAudience},
		},
	}

	clientInterceptor, err := authnlib.NewGrpcClientInterceptor(&grpcClientConfig)
	if err != nil {
		return nil, err
	}

	clientCfg := authzlib.MultiTenantClientConfig{RemoteAddress: authCfg.remoteAddress}
	client, err := authzlib.NewLegacyClient(&clientCfg,
		authzlib.WithGrpcDialOptionsLCOption(
			getDialOpts(clientInterceptor, authCfg.allowInsecure)...,
		),
	)
	if err != nil {
		return nil, err
	}

	return client, nil
}

func getDialOpts(interceptor *authnlib.GrpcClientInterceptor, allowInsecure bool) []grpc.DialOption {
	dialOpts := []grpc.DialOption{
		grpc.WithUnaryInterceptor(interceptor.UnaryClientInterceptor),
		grpc.WithStreamInterceptor(interceptor.StreamClientInterceptor),
	}
	if allowInsecure {
		// allow insecure connections in development mode to facilitate testing
		dialOpts = append(dialOpts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}

	return dialOpts
}
