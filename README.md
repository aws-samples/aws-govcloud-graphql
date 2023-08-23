
# Implementation of GraphQL based architectures in AWS GovCloud(US) to support missions

Please see the associated AWS [blog](https://aws.amazon.com/blogs/publicsector/implement-serverless-graphql-architecture-aws-govcloud-us-optimize-api/) for details.

Important: this application uses various AWS services and there are costs associated with these services after the Free Tier usage - please see the [AWS Pricing page](https://aws.amazon.com/pricing/) for details. You are responsible for any AWS costs incurred. No warranty is implied in this example.

```bash
.
├── README.MD           <-- Deployment Instructions file
├── 1-infra             <-- Project for building out the infrastructure shown in the architecture 
├── 2-mission-gen-ai    <-- Project creates an Amazon SageMaker endpoint which invokes a generative AI model for text generation
```

## Requirements

* An [AWS GovCloud (US)](https://aws.amazon.com/govcloud-us/?whats-new-ess.sort-by=item.additionalFields.postDateTime&whats-new-ess.sort-order=desc) account. ([Create a GovCloud account](https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/getting-started-sign-up.html) if you do not already have one and login.). **Note:** A GovCloud account is not required, as this project can be deployed to an AWS standard account. GovCloud is recommended, in order to follow along with the content presented in the blog mentioned earlier. If an AWS standard account is preferred, then [Create an AWS standard account](https://portal.aws.amazon.com/gp/aws/developer/registration/index.html) and log in.
* AWS CLI already configured with appropriate permissions to build and deploy [CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)
* [NodeJS 14.x installed](https://nodejs.org/en/download/)
* [AWS Cloud Development Kit (AWS CDK) v2 installed](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html) *minimum version 2.84*.

## Installation Instructions

1. Clone the repo onto your local development machine:
```
git clone https://github.com/aws-samples/aws-govcloud-graphql
```

### 1. Set up infrastructure

1. From the command line, install the infrastructure stack for the solution (InfraStack and the nested stacks 1. -baseresources, -personnelresources and -adminresources):

Before building, you may need to change the name of the DynamoDB table to be created, in case a table with that name exists already. The configurations are in the `config.json` file in the base directory of this solution. Change the value of the *TableName* field, if required.
```sh
cd ./1-infra
cd lambdas && npm i && cd .. && npm i && npm run build
cdk bootstrap
cdk deploy
```
During the following prompt, `Do you wish to deploy these changes (y/n)?`, enter *y*, to enable the infrastructure to deployed.

Note the following from the `Outputs` section of the deployment in the nested stacks, as some of the values would be required for the next steps. Alternatively, these values can be retrieved from the *[Outputs](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/outputs-section-structure.html)* section of the AWS CloudFormation stack, via the AWS Management Console.

**Sample** output:
```
InfraStackbaseresourcesgqluserPool<Random value>Arn	arn:aws-us-gov:cognito-idp:us-gov-west-1:<AWS Account ID>:userpool/us-gov-west-1_<random value>
personnel-apigw-endpoint-url https://<random value>.execute-api.us-gov-west-1.amazonaws.com/prod/	The API Gateway endpoint url for Personnel	
admin-apigw-endpoint-url	https://<random value>.execute-api.us-gov-west-1.amazonaws.com/prod/	The API Gateway endpoint url for Admin	
```

### 2. Configuring and deploying the Generative AI stack

Note: This solution assumes that the Generative AI model is previously provided by data scientists, and the ML model training and tuning is outside the scope of this solution. You may use the following [workshop](https://github.com/aws-samples/hugging-face-workshop), as a reference on how to deploy text generation models on Amazon SageMaker.

1. create S3 Bucket, and upload *model.tar.gz* into the S3 Bucket. Note the bucket name, as that would be needed in the next step

2. Before deploying, some configuration parameters have to be updated. The configurations are in the `config.json` file in the base directory of this solution. 

```json
{
    "Database": {
        "TableName": "missions"
    },
    "Cognito" : {
        "UserPoolArn": "<Congito User Pool Arn>",
        "AdminScope": "adminusers/*"
    },
    "GenAIModel" : {
        "BucketName" : "<BUCKET-NAME>"
    }
}
```

Update the value of the *TableName* field, if required.
From the output of the stack in the previous section, update the *UserPoolArn* value with the value of *InfraStackbaseresourcesgqluserPool<Random value>Arn*
Update the value of the *BucketName* parameter, with the name of the bucket used/created in the previous step

- userPoolId: The Amazon Cognito pool ID from earlier (Value of AwsGovcloudServerlessAppStack.userPoolId).
- clientId: The Cognito App client ID from earlier (Value of AwsGovcloudServerlessAppStack.appClientId).
- apiUrl: The url of the Amazon API Gateway resource from earlier (Value of AwsGovcloudServerlessAppStack.apigwendpointurl).


```
cd ../2-mission-gen-ai
npm install
npm run build
cdk deploy
```

During the following prompt, `Do you wish to deploy these changes (y/n)?`, enter *y*, to enable the infrastructure to deployed.

Note the following from the `Outputs` section of the deployment, as the value may be required. Alternatively, these values can be retrieved from the *[Outputs](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/outputs-section-structure.html)* section of the AWS CloudFormation stack, via the AWS Management Console.

**Sample** output:
```
SagemakerendpointStack.MissionSMApiGatewayEndpoint<Random value> = https://<random value>.execute-api.us-gov-west-1.amazonaws.com/prod/
```

### 3. Refer to the blog for the rest of the setup 

## Cleanup

1. Manually delete any objects in the S3 buckets created in step 1 of the installation instructions.
2. If the Generative AI stack is also deployed,please run the following commands in the base directory
```sh
cd ./2-mission-gen-ai
cdk destroy
```
3. To cleanup the infrastructure stack use the CloudFormation console to delete all the stacks deployed or in the base directory
```sh
cd ./1-infra
cdk destroy
```

During the following prompt `Are you sure you want to delete: <Stack Name> (y/n)`, , enter *y*, to enable the infrastructure to destroyed.
3. There may be additional cleanup required, for resources created in the steps mentioned in this README (e.g. The S3 bucket hosting the ML Model), or in the blog. Please follow the cleanup notes in the blog as applicable.

If you have any questions, please contact the author or raise an issue in the GitHub repo.

==============================================

Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.

SPDX-License-Identifier: MIT-0
