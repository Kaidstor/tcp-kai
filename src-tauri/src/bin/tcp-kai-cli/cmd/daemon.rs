//! `tcp-kai daemon` — управление keep-alive-демоном (пул TCP-соединений).

use std::time::Duration;

use clap::{Args, Subcommand};

use crate::daemon;
use crate::output::{CliError, Done, Printer};

#[derive(Args)]
pub struct DaemonArgs {
    #[command(subcommand)]
    pub cmd: DaemonCmd,
}

#[derive(Subcommand)]
pub enum DaemonCmd {
    /// Запустить в форграунде (обычно не нужно: send поднимает демона сам)
    Run {
        /// Сколько секунд держать простаивающее соединение в пуле
        #[arg(long, value_name = "СЕК")]
        ttl: Option<u64>,
        /// Через сколько секунд без запросов выйти самому
        #[arg(long = "idle-exit", value_name = "СЕК")]
        idle_exit: Option<u64>,
    },
    /// Остановить демона
    Stop,
    /// Аптайм и пул соединений
    Status,
}

pub async fn run(args: DaemonArgs, p: &mut Printer) -> Result<Done, CliError> {
    let sock = daemon::socket_path();
    match args.cmd {
        DaemonCmd::Run { ttl, idle_exit } => {
            let (default_ttl, default_idle) = daemon::default_timings();
            daemon::serve(
                sock,
                ttl.map(Duration::from_secs).unwrap_or(default_ttl),
                idle_exit.map(Duration::from_secs).unwrap_or(default_idle),
            )
            .await
            .map_err(|e| CliError::new(crate::output::code::TOOL, "daemon", e))?;
            Ok(Done::ok(()))
        }
        DaemonCmd::Stop => {
            match daemon::call(
                &sock,
                &daemon::DaemonRequest::Stop,
                Some(Duration::from_secs(5)),
            )
            .await
            {
                Ok(reply) => {
                    if !p.json {
                        eprintln!("{}", reply.message);
                    }
                    Ok(Done::ok(serde_json::json!({
                        "wasRunning": true,
                        "message": reply.message,
                    })))
                }
                Err(_) => {
                    if !p.json {
                        eprintln!("демон не запущен");
                    }
                    Ok(Done::ok(serde_json::json!({ "wasRunning": false })))
                }
            }
        }
        DaemonCmd::Status => {
            match daemon::call(
                &sock,
                &daemon::DaemonRequest::Status,
                Some(Duration::from_secs(5)),
            )
            .await
            {
                Ok(reply) => {
                    if !p.json {
                        println!("{}", reply.message);
                    }
                    Ok(Done::ok(serde_json::json!({
                        "running": true,
                        "socket": sock,
                        "status": reply.message,
                    })))
                }
                Err(_) => {
                    if !p.json {
                        println!("демон не запущен ({})", sock.display());
                    }
                    Ok(Done::ok(
                        serde_json::json!({ "running": false, "socket": sock }),
                    ))
                }
            }
        }
    }
}
