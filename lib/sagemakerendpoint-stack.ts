/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sagemaker from 'aws-cdk-lib/aws-sagemaker';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as regionInfo from 'aws-cdk-lib/region-info'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import UserPoolStackProps from './infra-stack'

export class SagemakerendpointStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: UserPoolStackProps) {
    super(scope, id, props);

    // Deep Learning Container setup
    const repositoryName = 'huggingface-pytorch-inference';
    const tag = '1.7.1-transformers4.6.1-cpu-py36-ubuntu18.04';

    //if no default region specified just use us-east-1
    let accountId = regionInfo.Fact.find(process.env.CDK_DEFAULT_REGION ?? 'us-east-1', regionInfo.FactName.DLC_REPOSITORY_ACCOUNT);
    if (process.env.CDK_DEFAULT_REGION === 'us-gov-west-1') accountId = '442386744353';

    const repository = ecr.Repository.fromRepositoryAttributes(this, 'DlcRepository', {
      repositoryName: repositoryName,
      repositoryArn: ecr.Repository.arnForLocalRepository(repositoryName, this, accountId),
    });
    
    const config = require('../config.json')
    const hfmodelbucket = s3.Bucket.fromBucketName(this, 'hfmodelbucket', config.GenAIModel.BucketName);
    
    // const modelData = sagemakeralpha.ModelData.fromBucket(hfmodelbucket, 'model.tar.gz');
    const modelData = hfmodelbucket.urlForObject('model.tar.gz')
    const sagemakerRole = new iam.Role(this, 'SagemakerRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
    });
    sagemakerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'));
    sagemakerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'));

    const model = new sagemaker.CfnModel(this, 'InferencePipelineModel', {
      executionRoleArn: sagemakerRole.roleArn,
      modelName: 'ModelName',
      primaryContainer: {
        image: repository.repositoryUriForTag(tag),
        modelDataUrl: modelData,
      }
    })

    // Create a CfnEndpointConfig
    const endpointConfig = new sagemaker.CfnEndpointConfig(this, 'SageMakerEndpointConfig', {
      endpointConfigName: 'MissionGptjEndpointConfig',
      productionVariants: [
        {
          variantName: 'MissionGptjVariant',
          modelName: "ModelName",
          initialInstanceCount: 1,
          instanceType: "ml.m5.2xlarge",
          initialVariantWeight: 1,
        }
      ],
    })
    endpointConfig.addDependency(model)
    const endpoint = new sagemaker.CfnEndpoint(this, 'MissionSMEndpoint', { 
        endpointConfigName: "MissionGptjEndpointConfig" 
      }
    )
    endpoint.addDependency(endpointConfig)

    // Create an API Gateway
    const api = new apigateway.RestApi(this, 'MissionSMApiGateway',{
        endpointTypes: [apigateway.EndpointType.REGIONAL]
    });


    const lambdaRole = new iam.Role(this, `smlambda-role`, {
            roleName: `smlambda-role`,
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        });
    lambdaRole.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' });
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sagemaker:InvokeEndpoint'],
      resources: [ endpoint.ref ]
    }));
        
    // Create a Lambda function that invokes the SageMaker endpoint
    const lambdaFn = new lambda.Function(this, 'MissionSMLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_8,
      timeout: cdk.Duration.seconds(60),
      handler: 'lambda-handler.handler',
      role: lambdaRole,
      code: lambda.Code.fromAsset('lambda'),
      environment: {"ENDPOINT_NAME": endpoint.attrEndpointName},
    });

    // Create an API Gateway resource for the endpoint
    const endpointResource = api.root.addResource('endpoint');

    const adminauthorizer = new apigateway.CfnAuthorizer(this, 'cfnAuth', {
      restApiId: api.restApiId,
      name: 'AdminAPIAuthorizer',
      type: 'COGNITO_USER_POOLS',
      identitySource: 'method.request.header.Authorization',
      providerArns: [ props.UserPool.userPoolArn ],
    });
    
    // Create an API Gateway method that invokes the Lambda function
    endpointResource.addMethod('POST', new apigateway.LambdaIntegration(lambdaFn), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: [ config.Cognito.AdminScope ],
      authorizer: {
        authorizerId: adminauthorizer.ref
      },
    });
  }
}