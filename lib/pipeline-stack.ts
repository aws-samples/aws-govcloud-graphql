/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Repository } from 'aws-cdk-lib/aws-codecommit';
import { CodePipeline, CodePipelineSource, ShellStep} from 'aws-cdk-lib/pipelines'
import { CdkpipelinesDemoStage } from './pipeline-stage';

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = require('../config.json')
    const repo = Repository.fromRepositoryName(this, 'repoLookup', config.CodeCommit.RepoName)

    const pipeline = new CodePipeline(this, 'Pipeline', {
      // The pipeline name
      pipelineName: 'MyServicePipeline',
      // enable docker daemon
      dockerEnabledForSynth: true,

       // How it will be built and synthesized
       synth: new ShellStep('Synth', {
        input: CodePipelineSource.codeCommit(repo, 'master'),
         
         // Install dependencies, build and run cdk synth
         commands: [
           'npm install',
           'cd lambda',
           'npm install',
           'cd ..',
           'npm run build',
           'npm i -g aws-cdk',
           'cdk synth',
         ],
       }),
    });

    // This is where we add the application stages
    // ...
    // pipeline.addStage(new CdkpipelinesDemoStage(this, 'Infra', {}));
  }
}
