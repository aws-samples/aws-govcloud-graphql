/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { InfraStack } from './infra-stack';
import { SagemakerendpointStack } from './sagemakerendpoint-stack';
/**
 * Deployable unit of web service app
 */
export class CdkpipelinesDemoStage extends cdk.Stage {
  
  constructor(scope: Construct, id: string, props?: cdk.StageProps) {
    super(scope, id, props);

    const infra = new InfraStack(this, 'BaseInfra', {});

    const sgm = new SagemakerendpointStack(this, 'Sagemaker', {
      UserPool: infra.baseResources.userPool
    })
    sgm.addDependency(infra)

  }
}