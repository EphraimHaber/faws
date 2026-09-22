import type { Instance } from "@aws-sdk/client-ec2";
import { describe, expect, it } from "vitest";

import { instanceFacts } from "./execTargets.ts";

describe("instanceFacts", () => {
  it("reads every address and the details a list shows as their own columns", () => {
    const instance: Instance = {
      InstanceId: "i-0abc",
      PrivateIpAddress: "10.0.0.5",
      PrivateDnsName: "ip-10-0-0-5.ec2.internal",
      PublicIpAddress: "51.84.130.23",
      PublicDnsName: "ec2-51-84-130-23.compute.amazonaws.com",
      Ipv6Address: "2a05:d01c::1",
      SubnetId: "subnet-1",
      Architecture: "arm64",
      ImageId: "ami-1",
      LaunchTime: new Date("2026-01-02T03:04:05.000Z"),
      IamInstanceProfile: { Arn: "arn:aws:iam::123456789012:instance-profile/web-role" },
      SecurityGroups: [{ GroupName: "web" }, { GroupName: "ssh" }],
    };
    expect(instanceFacts(instance)).toEqual({
      privateDns: "ip-10-0-0-5.ec2.internal",
      publicDns: "ec2-51-84-130-23.compute.amazonaws.com",
      ipv6: "2a05:d01c::1",
      subnetId: "subnet-1",
      architecture: "arm64",
      imageId: "ami-1",
      launchedAt: "2026-01-02T03:04:05.000Z",
      instanceProfile: "web-role",
      securityGroups: "web, ssh",
    });
  });

  it("finds an IPv6 address on the network interface when the instance has no primary one", () => {
    const instance: Instance = {
      NetworkInterfaces: [{ Ipv6Addresses: [{ Ipv6Address: "2a05:d01c::9" }] }],
    };
    expect(instanceFacts(instance).ipv6).toBe("2a05:d01c::9");
  });

  it("answers null for what the instance does not have", () => {
    expect(instanceFacts({})).toEqual({
      privateDns: null,
      publicDns: null,
      ipv6: null,
      subnetId: null,
      architecture: null,
      imageId: null,
      launchedAt: null,
      instanceProfile: null,
      securityGroups: null,
    });
  });
});
