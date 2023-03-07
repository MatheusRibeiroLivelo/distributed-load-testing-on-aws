// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockAWS = require("aws-sdk");
const mockEcs = {
  listTasks: jest.fn(),
  describeTasks: jest.fn(),
  stopTask: jest.fn(),
};
const mockDynamoDb = {
  update: jest.fn(),
  get: jest.fn(),
};
const mockLambda = {
  invoke: jest.fn(),
};
mockAWS.ECS = jest.fn(() => ({
  listTasks: mockEcs.listTasks,
  describeTasks: mockEcs.describeTasks,
  stopTask: mockEcs.stopTask,
}));
mockAWS.DynamoDB.DocumentClient = jest.fn(() => ({
  update: mockDynamoDb.update,
  get: mockDynamoDb.get,
}));
mockAWS.Lambda = jest.fn(() => ({
  invoke: mockLambda.invoke,
}));

process.env = {
  SCENARIOS_TABLE: "mock-scenario-table",
  TASK_CANCELER_ARN: "mock-task-canceler-arn",
  VERSION: "2.0.1",
  SOLUTION_ID: "SO0062",
};

const lambda = require("../index.js");
let event = {
  testTaskConfig: {
    region: "us-west-2",
    concurrency: 3,
    taskCount: 5,
    ecsCloudWatchLogGroup: "testEcsCloudWatchLogGroup",
    taskCluster: "testTaskCluster",
    taskDefinition: "arn:aws:ecs:us-west-2:123456789012:task-definition/testTaskDefinition:1",
    subnetB: "subnet-1111aaaa",
    taskImage: "test-load-tester",
    subnetA: "subnet-2222bbbb",
    taskSecurityGroup: "sg-abcd1234",
  },
  testId: "testId",
  testType: "simple",
  fileType: "none",
  isRunning: false,
};
const origEvent = event;

describe("task-status-checker", () => {
  beforeEach(() => {
    mockEcs.listTasks.mockReset();
    mockEcs.describeTasks.mockReset();
    mockDynamoDb.update.mockReset();
    mockDynamoDb.get.mockReset();
    event = { ...origEvent };
  });

  it("should return false for isRunning when there is no running task", async () => {
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: [] });
      },
    }));
    mockDynamoDb.get.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ Item: { status: "running" } });
      },
    }));

    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
    expect(response).toEqual(
      expect.objectContaining({
        testTaskConfig: {
          concurrency: 3,
          ecsCloudWatchLogGroup: "testEcsCloudWatchLogGroup",
          region: "us-west-2",
          subnetA: "subnet-2222bbbb",
          subnetB: "subnet-1111aaaa",
          taskCluster: "testTaskCluster",
          taskCount: 5,
          taskDefinition: "arn:aws:ecs:us-west-2:123456789012:task-definition/testTaskDefinition:1",
          taskImage: "test-load-tester",
          taskSecurityGroup: "sg-abcd1234",
        },
        fileType: "none",
        numTasksRunning: 1,
        isRunning: false,
        taskRunner: undefined,
        testId: "testId",
        testType: "simple",
      })
    );
  });

  it("should return false for isRunning when there is a running task but not a test task", async () => {
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: ["arn:of:ecs:task"] });
      },
    }));
    mockEcs.describeTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ tasks: [{ group: "other" }] });
      },
    }));
    mockDynamoDb.get.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ Item: { status: "running" } });
      },
    }));

    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
    expect(mockEcs.describeTasks).toHaveBeenCalledWith({
      cluster: event.testTaskConfig.taskCluster,
      tasks: ["arn:of:ecs:task"],
    });
    expect(response).toEqual(
      expect.objectContaining({
        isRunning: false,
        numTasksRunning: 1,
        taskRunner: undefined,
      })
    );
  });

  it("should return false for isRunning when there are running tasks but not test tasks", async () => {
    mockEcs.listTasks
      .mockImplementationOnce(() => ({
        promise() {
          return Promise.resolve({ taskArns: ["arn:of:ecs:task1"], nextToken: "next" });
        },
      }))
      .mockImplementationOnce(() => ({
        promise() {
          return Promise.resolve({ taskArns: ["arn:of:ecs:task2"] });
        },
      }));
    mockEcs.describeTasks
      .mockImplementationOnce(() => ({
        promise() {
          return Promise.resolve({ tasks: [{ group: "other" }] });
        },
      }))
      .mockImplementationOnce(() => ({
        promise() {
          return Promise.resolve({ tasks: [{ group: "other" }] });
        },
      }));
    mockDynamoDb.get.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ Item: { status: "running" } });
      },
    }));

    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenNthCalledWith(1, { cluster: event.testTaskConfig.taskCluster });
    expect(mockEcs.listTasks).toHaveBeenNthCalledWith(2, {
      cluster: event.testTaskConfig.taskCluster,
      nextToken: "next",
    });
    expect(mockEcs.describeTasks).toHaveBeenNthCalledWith(1, {
      cluster: event.testTaskConfig.taskCluster,
      tasks: ["arn:of:ecs:task1"],
    });
    expect(mockEcs.describeTasks).toHaveBeenNthCalledWith(2, {
      cluster: event.testTaskConfig.taskCluster,
      tasks: ["arn:of:ecs:task2"],
    });
    expect(response).toEqual(
      expect.objectContaining({
        isRunning: false,
        numTasksRunning: 1,
        taskRunner: undefined,
      })
    );
  });

  it("should return true for isRunning when there is a running test task", async () => {
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: ["arn:of:ecs:task"] });
      },
    }));
    mockEcs.describeTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ tasks: [{ group: event.testId }] });
      },
    }));
    mockDynamoDb.get.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ Item: { status: "running" } });
      },
    }));

    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
    expect(mockEcs.describeTasks).toHaveBeenCalledWith({
      cluster: event.testTaskConfig.taskCluster,
      tasks: ["arn:of:ecs:task"],
    });
    expect(response).toEqual(
      expect.objectContaining({
        testTaskConfig: {
          concurrency: 3,
          ecsCloudWatchLogGroup: "testEcsCloudWatchLogGroup",
          region: "us-west-2",
          subnetA: "subnet-2222bbbb",
          subnetB: "subnet-1111aaaa",
          taskCluster: "testTaskCluster",
          taskCount: 5,
          taskDefinition: "arn:aws:ecs:us-west-2:123456789012:task-definition/testTaskDefinition:1",
          taskImage: "test-load-tester",
          taskSecurityGroup: "sg-abcd1234",
        },
        isRunning: true,
        numTasksRunning: 1,
        taskRunner: undefined,
        fileType: "none",
        testId: "testId",
        testType: "simple",
      })
    );
  });

  it('should return false for isRunning when there is a running task but test status is not "running"', async () => {
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: ["arn:of:ecs:task"] });
      },
    }));
    mockEcs.describeTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ tasks: [{ group: event.testId }] });
      },
    }));
    mockDynamoDb.get.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ Item: { status: "cancelled" } });
      },
    }));

    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
    expect(mockEcs.describeTasks).toHaveBeenCalledWith({
      cluster: event.testTaskConfig.taskCluster,
      tasks: ["arn:of:ecs:task"],
    });
    expect(response).toEqual(
      expect.objectContaining({
        testTaskConfig: {
          concurrency: 3,
          ecsCloudWatchLogGroup: "testEcsCloudWatchLogGroup",
          region: "us-west-2",
          subnetA: "subnet-2222bbbb",
          subnetB: "subnet-1111aaaa",
          taskCluster: "testTaskCluster",
          taskCount: 5,
          taskDefinition: "arn:aws:ecs:us-west-2:123456789012:task-definition/testTaskDefinition:1",
          taskImage: "test-load-tester",
          taskSecurityGroup: "sg-abcd1234",
        },
        isRunning: false,
        numTasksRunning: 1,
        taskRunner: undefined,
        fileType: "none",
        testId: "testId",
        testType: "simple",
      })
    );
  });

  it("should return false for isRunning and prefix when there is no test running and prefix is provided", async () => {
    mockEcs.listTasks.mockImplementation(() => ({
      promise() {
        return Promise.resolve({ taskArns: [] });
      },
    }));
    mockDynamoDb.get.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ Item: { status: "running" } });
      },
    }));

    event.prefix = "prefix";
    event.taskCount = 2;
    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
    expect(response).toEqual(
      expect.objectContaining({
        isRunning: false,
        prefix: "prefix",
        numTasksRunning: 1,
        taskRunner: undefined,
      })
    );
  });

  it("should return true for isRunning and prefix when a test is still running and prefix is provided", async () => {
    mockEcs.listTasks.mockImplementation(() => ({
      promise() {
        return Promise.resolve({ taskArns: ["arn:of:ecs:task1", "arn:of:ecs:task2"] });
      },
    }));
    mockEcs.describeTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ tasks: [{ group: event.testId }, { group: event.testId }] });
      },
    }));
    mockDynamoDb.get.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ Item: { status: "running" } });
      },
    }));
    event.prefix = "prefix";
    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
    expect(mockEcs.describeTasks).toHaveBeenCalledWith({
      cluster: event.testTaskConfig.taskCluster,
      tasks: ["arn:of:ecs:task1", "arn:of:ecs:task2"],
    });
    expect(response).toEqual(
      expect.objectContaining({
        isRunning: true,
        prefix: "prefix",
        numTasksRunning: 1,
        taskRunner: undefined,
      })
    );
  });

  it("should return true for isRunning, timeoutCount and prefix when a test is still running, any tasks completed, and prefix is provided", async () => {
    event.taskCount = 3;
    mockEcs.listTasks.mockImplementation(() => ({
      promise() {
        return Promise.resolve({ taskArns: ["arn:of:ecs:task1"] });
      },
    }));
    mockEcs.describeTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ tasks: [{ group: event.testId, taskArn: "arn:of:ecs:task1" }] });
      },
    }));
    mockDynamoDb.get.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ Item: { status: "running" } });
      },
    }));
    event.prefix = "prefix";
    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
    expect(mockEcs.describeTasks).toHaveBeenCalledWith({
      cluster: event.testTaskConfig.taskCluster,
      tasks: ["arn:of:ecs:task1"],
    });
    expect(response).toEqual(
      expect.objectContaining({
        isRunning: true,
        prefix: "prefix",
        timeoutCount: 10,
        numTasksRunning: 1,
        taskRunner: undefined,
      })
    );
  });

  it("should return false for isRunning and prefix when timeout happens", async () => {
    mockEcs.listTasks.mockImplementation(() => ({
      promise() {
        return Promise.resolve({ taskArns: ["arn:of:ecs:task1"] });
      },
    }));
    mockEcs.describeTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ tasks: [{ group: event.testId, taskArn: "arn:of:ecs:task1" }] });
      },
    }));
    mockLambda.invoke.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve();
      },
    }));
    mockDynamoDb.get.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ Item: { status: "running" } });
      },
    }));

    event.prefix = "prefix";
    event.timeoutCount = 1;
    const response = await lambda.handler(event);
    expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
    expect(mockEcs.describeTasks).toHaveBeenCalledWith({
      cluster: event.testTaskConfig.taskCluster,
      tasks: ["arn:of:ecs:task1"],
    });
    expect(mockLambda.invoke).toHaveBeenCalledWith({
      FunctionName: process.env.TASK_CANCELER_ARN,
      InvocationType: "Event",
      Payload: JSON.stringify({ testId: event.testId, testTaskConfig: event.testTaskConfig }),
    });
    expect(response).toEqual(
      expect.objectContaining({
        isRunning: false,
        prefix: "prefix",
        timeoutCount: 0,
        numTasksRunning: 1,
        taskRunner: undefined,
      })
    );
  });

  it("should throw an error when listTasks fails", async () => {
    mockEcs.listTasks.mockImplementation(() => ({
      promise() {
        return Promise.reject("listTasks error");
      },
    }));
    mockDynamoDb.update.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve();
      },
    }));

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.testId,
        },
        UpdateExpression: "set #s = :s, #e = :e",
        ExpressionAttributeNames: {
          "#s": "status",
          "#e": "errorReason",
        },
        ExpressionAttributeValues: {
          ":s": "failed",
          ":e": "Failed to check Fargate tasks.",
        },
      });
      expect(error).toEqual("listTasks error");
    }
  });

  it("should throw an error when describeTasks fails", async () => {
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: ["arn:of:ecs:task"] });
      },
    }));
    mockEcs.describeTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.reject("describeTasks error");
      },
    }));
    mockDynamoDb.update.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve();
      },
    }));

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
      expect(mockEcs.describeTasks).toHaveBeenCalledWith({
        cluster: event.testTaskConfig.taskCluster,
        tasks: ["arn:of:ecs:task"],
      });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.testId,
        },
        UpdateExpression: "set #s = :s, #e = :e",
        ExpressionAttributeNames: {
          "#s": "status",
          "#e": "errorReason",
        },
        ExpressionAttributeValues: {
          ":s": "failed",
          ":e": "Failed to check Fargate tasks.",
        },
      });
      expect(error).toEqual("describeTasks error");
    }
  });

  it("should throw an error when task canceler lambda fails", async () => {
    mockEcs.listTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ taskArns: ["arn:of:ecs:task"] });
      },
    }));
    mockEcs.describeTasks.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ tasks: [{ group: "xyz", taskArn: "arn:of:ecs:task" }] });
      },
    }));
    mockLambda.invoke.mockImplementationOnce(() => ({
      promise() {
        return Promise.reject("stopTask error");
      },
    }));
    mockDynamoDb.update.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve();
      },
    }));
    mockDynamoDb.get.mockImplementationOnce(() => ({
      promise() {
        return Promise.resolve({ Item: { status: "running" } });
      },
    }));

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
      expect(mockEcs.describeTasks).toHaveBeenCalledWith({
        cluster: event.testTaskConfig.taskCluster,
        tasks: ["arn:of:ecs:task"],
      });
      expect(mockLambda.invoke).toHaveBeenCalledWith({
        FunctionName: process.env.TASK_CANCELER_ARN,
        InvocationType: "Event",
        Payload: JSON.stringify({ testId: event.testId, testTaskConfig: event.testTaskConfig }),
      });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.testId,
        },
        UpdateExpression: "set #s = :s, #e = :e",
        ExpressionAttributeNames: {
          "#s": "status",
          "#e": "errorReason",
        },
        ExpressionAttributeValues: {
          ":s": "failed",
          ":e": "Failed to check Fargate tasks.",
        },
      });
      expect(error).toEqual("stopTask error");
    }
  });

  it("should throw an error when DynamoDB.DocumentClient.update fails and not update the DynamoDB", async () => {
    mockEcs.listTasks.mockImplementation(() => ({
      promise() {
        return Promise.reject("listTasks error");
      },
    }));
    mockDynamoDb.update.mockImplementationOnce(() => ({
      promise() {
        return Promise.reject("DynamoDB.DocumentClient.update failed");
      },
    }));

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockEcs.listTasks).toHaveBeenCalledWith({ cluster: event.testTaskConfig.taskCluster });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.testId,
        },
        UpdateExpression: "set #s = :s, #e = :e",
        ExpressionAttributeNames: {
          "#s": "status",
          "#e": "errorReason",
        },
        ExpressionAttributeValues: {
          ":s": "failed",
          ":e": "Failed to check Fargate tasks.",
        },
      });
      expect(error).toEqual("DynamoDB.DocumentClient.update failed");
    }
  });
});
