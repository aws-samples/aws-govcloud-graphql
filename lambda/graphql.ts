/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */
import { getMission } from './get-one';
import { createMissionFn } from './create-mission';

const { ApolloServer, gql } = require("@apollo/server");

const TABLE_NAME = process.env.TABLE_NAME || '';

const typeDefs = gql`
  type Query {
    GetMission(id: ID!): MissionOutput
  }
  
  type MissionOutput {
    id: String
    name: String
    description: String
  }
  
  input CreateMissionInput {
    name: String!
    description: String!
  }
  
  type CreateMissionOutput {
    id: ID!
    name: String!
  }
  
  type Mutation {
    createMission(input: CreateMissionInput): CreateMissionOutput!
  }
`;

const resolvers = {
  Query: {
    GetMission: async (parent: any, args: any, context: any) => { 
      return await getMission(args.id, TABLE_NAME); },
  },
  Mutation: {
    createMission: async(parent: any, args: any, context: any) => {
      return await createMissionFn(args.input.name, args.input.description, TABLE_NAME);
    }
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  // If you'd like to have GraphQL Playground and introspection enabled in production,
  // the `playground` and `introspection` options must be set explicitly to `true`.
  playground: true,
  introspection: true,
});

exports.handler = server.createHandler();

