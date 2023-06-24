/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */
import * as cdk from 'aws-cdk-lib';
import * as sagemakeralpha from '@aws-cdk/aws-sagemaker-alpha';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as sagemaker from 'aws-cdk-lib/aws-sagemaker';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';

export class SagemakerendpointStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Deep Learning Container setup
    const repositoryName = 'huggingface-pytorch-inference';
    const tag = '1.7.1-transformers4.6.1-cpu-py36-ubuntu18.04';
    const currentRegion = process.env.CDK_DEFAULT_REGION;

    let image;
    // Check if current region is us-gov-west-1
    if (currentRegion === 'us-gov-west-1') {
      const dlcgcaccountid = '442386744353';
      image = sagemakeralpha.ContainerImage.fromDlc(repositoryName, tag, dlcgcaccountid);
    } else {
      image = sagemakeralpha.ContainerImage.fromDlc(repositoryName, tag);
    }
    
    const config = require('../../config.json')
    
    const hfmodelbucket = s3.Bucket.fromBucketName(this, 'hfmodelbucket', config.GenAIModel.BucketName);
    
    const modelData = sagemakeralpha.ModelData.fromBucket(hfmodelbucket, 'model.tar.gz');
    
    const model = new sagemakeralpha.Model(this, 'InferencePipelineModel', {
      containers: [
        { image: image, modelData: modelData }
      ],
    });
    
    // Create a SageMaker endpoint configuration
    const endpointConfig = new sagemakeralpha.EndpointConfig(this, 'SageMakerEndpointConfig', {
      endpointConfigName: 'MissionGptjEndpointConfig',
      instanceProductionVariants: [
        {
          variantName: 'MissionGptjVariant',
          model: model,
          initialInstanceCount: 1,
          instanceType: sagemakeralpha.InstanceType.M5_2XLARGE,
        }
      ],
    });
    
    // Create a SageMaker endpoint
    const endpoint = new sagemakeralpha.Endpoint(this, 'MissionSMEndpoint', { endpointConfig });

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
      resources: [ endpoint.endpointArn ]
    }));
        
    // Create a Lambda function that invokes the SageMaker endpoint
    const lambdaFn = new lambda.Function(this, 'MissionSMLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_8,
      timeout: cdk.Duration.seconds(60),
      handler: 'lambda-handler.handler',
      role: lambdaRole,
      code: lambda.Code.fromAsset('lambda'),
      environment: {"ENDPOINT_NAME": endpoint.endpointName},
    });

    // Create an API Gateway resource for the endpoint
    const endpointResource = api.root.addResource('endpoint');

    const adminauthorizer = new apigateway.CfnAuthorizer(this, 'cfnAuth', {
      restApiId: api.restApiId,
      name: 'AdminAPIAuthorizer',
      type: 'COGNITO_USER_POOLS',
      identitySource: 'method.request.header.Authorization',
      providerArns: [ config.Cognito.UserPoolArn ],
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
