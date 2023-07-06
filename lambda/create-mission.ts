/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */
import { DynamoDBClient, PutItemCommand, PutItemCommandInput } from "@aws-sdk/client-dynamodb";
import { ulid } from 'ulid';

const client = new DynamoDBClient({});

export const createMissionFn = async(name: string, description: string, tableName: string) : Promise<any> => {
  if (!name || !description) {
    return { statusCode: 400, body: `Error: You are missing the path parameter id` };
  }
  
  console.log('createMissionFn called with' + name + ':' + description);
  
  const id = ulid().toLowerCase();
  
  console.log('createMission id created: ' + id)
  
  const input : PutItemCommandInput = {
    TableName: tableName,
    Item: {
      "PK": { S: id }, 
      "SK": { S: id },
      "Name": { S: name },
      "Description": { S: description }
      
    },
  }
  
  try {
    // Send the request to DynamoDB
    const command = new PutItemCommand(input);
    const response = await client.send(command);
    if (response) {
      console.log("Returning:" + { id: id, name: name })
      return { id: id, name: name }
    } else {
      console.log("Failed 404")
      return "statusCode: 404";
    }
  } catch (dbError) {
    console.log("dbError:" + JSON.stringify(dbError));
    return JSON.stringify(dbError);
  }

}
