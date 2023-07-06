/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */
import { DynamoDBClient, GetItemCommand, GetItemCommandInput } from "@aws-sdk/client-dynamodb";


const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';

const client = new DynamoDBClient({});

export const getMission = async(missionId: any, tableName: string) : Promise<any> => {
  if (!missionId) {
    return { statusCode: 400, body: `Error: You are missing the path parameter id` };
  }
  
  const params : GetItemCommandInput = {
    TableName: tableName,
    Key: {
      "PK": { S: missionId },
      "SK": { S: missionId },
    },
  };

  try {
    // Send the request to DynamoDB
    const command = new GetItemCommand(params);
    const response = await client.send(command);
    if (response.Item) {
      console.log("Mission:" + JSON.stringify(response.Item));
      
      return { id: response.Item.PK.S, name: response.Item.Name.S, description: response.Item.Description.S }
    } else {
      return "statusCode: 404";
    }
  } catch (dbError) {
    return JSON.stringify(dbError);
  }
}
