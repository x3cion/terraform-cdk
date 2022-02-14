import { exec, readCDKTFVersion } from "cdktf-cli/lib/util";
import {
  Terraform,
  TerraformPlan,
  TerraformOutput,
  AbstractTerraformPlan,
} from "./terraform";
import { SynthesizedStack } from "../synth-stack";
import { terraformBinaryName } from "../../bin/cmds/helper/terraform";

export class TerraformCliPlan
  extends AbstractTerraformPlan
  implements TerraformPlan
{
  constructor(
    public readonly planFile: string,
    public readonly plan: { [key: string]: any }
  ) {
    super(planFile, plan.resource_changes, plan.output_changes);
  }
}

export class TerraformCli implements Terraform {
  public readonly workdir: string;
  private readonly onStdOut: (stdout: Buffer) => void;
  private readonly onStdErr: (stderr: string | Uint8Array) => void;

  constructor(
    public readonly stack: SynthesizedStack,
    sendLog = (_stdout: string, _isErr = false) => {} // eslint-disable-line @typescript-eslint/no-empty-function
  ) {
    this.workdir = stack.workingDirectory;
    this.onStdOut = (stdout: Buffer) => sendLog(stdout.toString());
    this.onStdErr = (stderr: string | Uint8Array) =>
      sendLog(stderr.toString(), true);
  }

  public async init(): Promise<void> {
    await this.setUserAgent();
    await exec(
      terraformBinaryName,
      ["init", "-input=false"],
      {
        cwd: this.workdir,
        env: process.env,
      },
      this.onStdOut,
      this.onStdErr
    );
  }

  public async plan(destroy = false): Promise<TerraformPlan> {
    const planFile = "plan";
    const options = ["plan", "-input=false", "-out", planFile];
    if (destroy) {
      options.push("-destroy");
    }
    await this.setUserAgent();
    await exec(
      terraformBinaryName,
      options,
      {
        cwd: this.workdir,
        env: process.env,
      },
      this.onStdOut,
      this.onStdErr
    );

    const jsonPlan = await exec(
      terraformBinaryName,
      ["show", "-json", planFile],
      { cwd: this.workdir, env: process.env },
      this.onStdOut,
      this.onStdErr
    );
    return new TerraformCliPlan(planFile, JSON.parse(jsonPlan));
  }

  public async deploy(
    planFile: string,
    stdout: (chunk: Buffer) => any,
    extraOptions: string[] = []
  ): Promise<void> {
    await this.setUserAgent();
    await exec(
      terraformBinaryName,
      [
        "apply",
        "-auto-approve",
        "-input=false",
        ...extraOptions,
        // only appends planFile if not empty
        // this allows deploying without a plan (as used in watch)
        ...(planFile ? [planFile] : []),
      ],
      { cwd: this.workdir, env: process.env },
      (buffer: Buffer) => {
        this.onStdOut(buffer);
        stdout(buffer);
      },
      this.onStdErr
    );
  }

  public async destroy(stdout: (chunk: Buffer) => any): Promise<void> {
    await this.setUserAgent();
    await exec(
      terraformBinaryName,
      ["destroy", "-auto-approve", "-input=false"],
      { cwd: this.workdir, env: process.env },
      (buffer: Buffer) => {
        this.onStdOut(buffer);
        stdout(buffer);
      },
      this.onStdErr
    );
  }

  public async version(): Promise<string> {
    try {
      return await exec(
        terraformBinaryName,
        ["-v"],
        {
          cwd: this.workdir,
          env: process.env,
        },
        this.onStdOut,
        this.onStdErr
      );
    } catch {
      throw new Error(
        "Terraform CLI not present - Please install a current version https://learn.hashicorp.com/terraform/getting-started/install.html"
      );
    }
  }

  public async output(): Promise<{ [key: string]: TerraformOutput }> {
    const output = await exec(
      terraformBinaryName,
      ["output", "-json"],
      {
        cwd: this.workdir,
        env: process.env,
      },
      this.onStdOut,
      this.onStdErr
    );
    return JSON.parse(output);
  }

  public async setUserAgent(): Promise<void> {
    // Read the cdktf version from the 'cdk.tf.json' file
    // and set the user agent.
    const version = await readCDKTFVersion(this.workdir);
    if (version != "") {
      process.env.TF_APPEND_USER_AGENT =
        "cdktf/" + version + " (+https://github.com/hashicorp/terraform-cdk)";
    }
  }
}
