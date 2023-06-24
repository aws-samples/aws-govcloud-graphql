/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Table, AttributeType, BillingMode, ProjectionType, TableEncryption } 
  from 'aws-cdk-lib/aws-dynamodb';
import { OAuthScope, UserPool, UserPoolClient,  
  VerificationEmailStyle, ResourceServerScope } 
  from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { join } from 'path';
import { Tracing, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { ulid } from 'ulid';
import { WafwebaclToApiGatewayProps, WafwebaclToApiGateway }  
  from "@aws-solutions-constructs/aws-wafwebacl-apigateway";
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

export class InfraStack extends cdk.Stack {
  baseResources: BaseResources
  personnelResources: PersonnelResources
  adminResources: AdminResources
  
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.baseResources = new BaseResources(this, 'base-resources')
    const { userPool, missionsTable, apolloServer, nodeJsFunctionProps, wafv2webacl } = this.baseResources

    this.personnelResources = new PersonnelResources(this, 'personnel-resources', {
      userPool,
      missionsTable,
      apolloServer,
      nodeJsFunctionProps,
      wafv2webacl
    })
    
    this.adminResources = new AdminResources(this, 'admin-resources', {
      userPool,
      missionsTable,
      apolloServer,
      nodeJsFunctionProps,
      wafv2webacl
    })

    this.personnelResources.addDependency(this.baseResources)
    this.adminResources.addDependency(this.baseResources)
  }
}

class BaseResources extends cdk.NestedStack {
  userPool: UserPool
  missionsTable: Table
  apolloServer: lambda.NodejsFunction
  nodeJsFunctionProps : lambda.NodejsFunctionProps
  wafv2webacl: wafv2.CfnWebACL

  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props)
    
    const config = require('../../config.json')
    const tableName = config.Database.TableName;
    
     this.missionsTable = new Table(this, tableName, { 
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'PK',type: AttributeType.STRING},
      sortKey: { name: 'SK', type: AttributeType.STRING},
      /**
       *  The default removal policy is RETAIN, which means that cdk destroy will not attempt to delete
       * the new table, and it will remain in your account until manually deleted. By setting the policy to
       * DESTROY, cdk destroy will delete the table (even if it has data in it)
       */
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
      tableName: tableName,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true
    });
    
    // Cognito User Pool with Email Sign-in Type.
    this.userPool = new UserPool(this, 'gql-userPool', {
      signInAliases: {
        email: true
      },
      selfSignUpEnabled: true,
      userVerification: {
        emailSubject: 'Verify your email for our app!',
        emailBody: 'Thanks for signing up to our app! Your verification code is {####}',
        emailStyle: VerificationEmailStyle.CODE,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    });
    
    this.userPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: 'missions-app' + ulid().toLowerCase(),
      },
    });
    
    this.nodeJsFunctionProps = {
      bundling: {
        externalModules: [
          '@aws-sdk/lib-dynamodb', // Use the '@aws-sdk/lib-dynamodb' available in the Lambda runtime
        ],
      },
      depsLockFilePath: join(__dirname, '../lambdas', 'package-lock.json'),
      environment: {
        TABLE_NAME: this.missionsTable.tableName,
      },
      runtime: Runtime.NODEJS_16_X
    }
    
    //  Service hosted by an Apollo server running on AWS Lambda
    this.apolloServer = new lambda.NodejsFunction(this, `ApolloServer`, {
      entry: join(__dirname, '../lambdas/graphql.ts'),
      timeout: cdk.Duration.seconds(30),
      tracing: Tracing.ACTIVE,
      runtime: Runtime.NODEJS_16_X,
      ...this.nodeJsFunctionProps
    });  
    
    this.missionsTable.grantReadWriteData(this.apolloServer);
    
    // Create and associate WAF Web ACL with API Gateway
    // Create our Web ACL
    this.wafv2webacl = new wafv2.CfnWebACL(this, 'WebACL', {
      defaultAction: {
        allow: {}
      },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'webACL',
        sampledRequestsEnabled: true
      },
      rules: awsManagedRules.map(wafRule => wafRule.rule)
    });
  }
}

interface PersonnelResourcesProps extends cdk.NestedStackProps {
  userPool: UserPool
  missionsTable: Table
  apolloServer: lambda.NodejsFunction
  nodeJsFunctionProps : lambda.NodejsFunctionProps
  wafv2webacl: wafv2.CfnWebACL
}

class PersonnelResources extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: PersonnelResourcesProps) {
    super(scope, id, props)
    
    const personnelapi = new apigateway.RestApi(this, "personnelgqlEndpoint", {
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS, // default cors preflight options
      },
      deployOptions: {
        tracingEnabled: true,
      },
    });
    
    // WAF Web ACL construct attached to personnel API Gateway.
    new WafwebaclToApiGateway(this, 'wafwebacl-personnel-apigateway', {
      existingApiGatewayInterface: personnelapi,
      existingWebaclObj: props.wafv2webacl
    });
    
    const readOnlyScope = new ResourceServerScope({ scopeName: 'read', scopeDescription: 'Read-only access' });
    
    const userServer = props.userPool.addResourceServer('ResourceServer', {
      identifier: 'personnelusers',
      scopes: [ readOnlyScope ],
    });
    
    const personnelClient = props.userPool.addClient('personnel-client', {
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          OAuthScope.OPENID,
          OAuthScope.PROFILE,
          OAuthScope.resourceServer(userServer, readOnlyScope)
        ],
        callbackUrls: ['https://localhost']
      }
    });

    // Authorizer for the Hello World API that uses the
    // Cognito User pool to Authorize users.
    const authorizer = new apigateway.CfnAuthorizer(this, 'cfnAuth', {
      restApiId: personnelapi.restApiId,
      name: 'PersonnelAPIAuthorizer',
      type: 'COGNITO_USER_POOLS',
      identitySource: 'method.request.header.Authorization',
      providerArns: [props.userPool.userPoolArn],
    });
    
    const graphqlPostIntegration = new apigateway.LambdaIntegration(props.apolloServer);

    personnelapi.root.addMethod('POST', graphqlPostIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: [OAuthScope.resourceServer(userServer, readOnlyScope).scopeName ],
      authorizer: {
        authorizerId: authorizer.ref
      }
    });
    
     // Outputs
    new cdk.CfnOutput(this, 'userPoolId', {
      value: props.userPool.userPoolId,
      description: 'The Cognito User Pool Id',
      exportName: 'userPoolId',
    });

    new cdk.CfnOutput(this, 'apigw-endpoint-url', {
      value: personnelapi.url,
      description: 'The API Gateway endpoint url for Personnel',
      exportName: 'personnel-apigw-endpoint-url',
    });
  }
}


interface AdminResourcesProps extends cdk.NestedStackProps {
  userPool: UserPool
  missionsTable: Table
  apolloServer: lambda.NodejsFunction
  nodeJsFunctionProps : lambda.NodejsFunctionProps
  wafv2webacl: wafv2.CfnWebACL
}

class AdminResources extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: AdminResourcesProps) {
    super(scope, id, props)
    
    const adminapi = new apigateway.RestApi(this, "admingqlEndpoint", {
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS, // default cors preflight options
      },
      deployOptions: {
        tracingEnabled: true,
      },
    });
    
    // WAF Web ACL construct attached to admin API Gateway.
    new WafwebaclToApiGateway(this, 'wafwebacl-admin-apigateway', {
      existingApiGatewayInterface: adminapi,
      existingWebaclObj: props.wafv2webacl
    });
    
    const adminScope = new ResourceServerScope({ scopeName: '*', scopeDescription: 'Admin access' });
    
    const userServer = props.userPool.addResourceServer('AdminResourceServer', {
      identifier: 'adminusers',
      scopes: [ adminScope ],
    });
    
    const adminClient = props.userPool.addClient('admin-client', {
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          OAuthScope.OPENID,
          OAuthScope.PROFILE,
          OAuthScope.resourceServer(userServer, adminScope)
        ],
        callbackUrls: ['https://localhost']
      }
    });

    // Authorizer for the Hello World API that uses the
    // Cognito User pool to Authorize users.
    const adminauthorizer = new apigateway.CfnAuthorizer(this, 'cfnAuth', {
      restApiId: adminapi.restApiId,
      name: 'AdminAPIAuthorizer',
      type: 'COGNITO_USER_POOLS',
      identitySource: 'method.request.header.Authorization',
      providerArns: [props.userPool.userPoolArn],
    });
    
    const graphqlPostIntegration = new apigateway.LambdaIntegration(props.apolloServer);

      adminapi.root.addMethod('POST', graphqlPostIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: [OAuthScope.resourceServer(userServer, adminScope).scopeName ],
      authorizer: {
        authorizerId: adminauthorizer.ref
      }
    });
    
     // Outputs

    new cdk.CfnOutput(this, 'apigw-endpoint-url', {
      value: adminapi.url,
      description: 'The API Gateway endpoint url for Admin',
      exportName: 'admin-apigw-endpoint-url',
    });
  }
}


interface WafRule {
  name: string;
  rule: wafv2.CfnWebACL.RuleProperty;
}

const awsManagedRules: WafRule[] = [
  // AWS IP Reputation list includes known malicious actors/bots and is regularly updated
  {
      name: 'AWS-AWSManagedRulesAmazonIpReputationList',
      rule: {
      name: 'AWS-AWSManagedRulesAmazonIpReputationList',
      priority: 10,
      statement: {
          managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesAmazonIpReputationList',
          },
      },
      overrideAction: {
          none: {},
      },
      visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'AWSManagedRulesAmazonIpReputationList',
      },
      },
  },
  // Common Rule Set aligns with major portions of OWASP Core Rule Set
  {
      name: 'AWS-AWSManagedRulesCommonRuleSet',
      rule:
      {
      name: 'AWS-AWSManagedRulesCommonRuleSet',
      priority: 20,
      statement: {
          managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
          // Excluding generic RFI body rule for sns notifications
          // https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-list.html
            excludedRules: [
             { name: 'GenericRFI_BODY' },
             { name: 'SizeRestrictions_BODY' },
          ],
          },
      },
      overrideAction: {
          none: {},
      },
      visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'AWS-AWSManagedRulesCommonRuleSet',
      },
      },
  },
  // Blocks common SQL Injection
  {
      name: 'AWSManagedRulesSQLiRuleSet',
      rule: {
      name: 'AWSManagedRulesSQLiRuleSet',
      priority: 30,
      visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'AWSManagedRulesSQLiRuleSet',
      },
      overrideAction: {
          none: {},
      },
      statement: {
          managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesSQLiRuleSet',
          excludedRules: [],
          },
      },
      },
  },
  ];